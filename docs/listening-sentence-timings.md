# 听力句级时间戳 `sentence_timings`

> 目标功能：复盘时点原文里的任意一句，播放器只放音频里对应的那一句。
> 这份文档是字段契约；产线、题库、真题 mapper、播放器四处都只认这一份。

## 字段

挂在听力条目（lcr / lc / la / lat，生成库与真题库同构）上，与 `audio_url` 并列：

```json
"sentence_timings": [
  { "text": "Hey, I just got back from the library.", "start": 0,     "end": 2.31, "turn": 0, "speaker": "Woman" },
  { "text": "Did you find the book?",                 "start": 2.43,  "end": 3.5,  "turn": 0, "speaker": "Woman" },
  { "text": "Not yet.",                                "start": 3.78,  "end": 4.4,  "turn": 1, "speaker": "Man" }
]
```

| 键 | 含义 |
|---|---|
| `text` | 这一句**渲染时的原文**。播放器直接渲染这个列表，**不要**在前端重新切句：两套切法一有出入，句子和音频就错位。 |
| `start` / `end` | 这句在 `audio_url` 那条音频里的起止秒，保留 3 位小数。两者都是数字；对齐没定位到的句子两者都是 `null`（仍列出、不可点）。 |
| `turn` / `speaker` | 只有对话（lc）有：`turn` 是 `conversation[]` 的下标，`speaker` 是该轮说话人名。 |

体检口是 `lib/listening/sentenceTimings.js` 的 `normalizeSentenceTimings`：任何一条不合格（缺文本、负数、
`end < start`、时间倒流、只给一半 null）就整份判 `null`。半份错位比没有更糟——点哪句放哪句全串。

## 时间戳从哪来

**生成库 + 真题 TTS 配音（零成本，产线顺带）**
`lib/tts/renderListening.js` 本来就是一句一次 TTS、再用 `concatWavSegmentsTimed` 拼接
（句间 120ms 静音，换人 280ms），拼接那一刻每句的起止就是精确的采样数换算。
`renderSingleSpeakerTimed` / `renderConversationTimed` 把它随 WAV 一起交出来，写入口：

- `scripts/backfill-tts.mjs`（Actions `backfill-audio.yml` 常规产线，`--tts-provider=openai`）
- `scripts/rerender-listening-audio.mjs`（存量重配）
- `scripts/realbank/render_real_audio.mjs`（真题 TTS 配音）

**真题原声（待做，见 BACKLOG）**
真人录音没有句级信息，要用 `scripts/realbank/asr_words.py` 的词级时间戳把已知原文按句对齐，
产物写进 `data/realBank/listening/original-audio.json` 条目的 `sentence_timings`，
`applyOriginalAudio` 挂原声时一并挂上。

## 与 `audio_url` 同生同灭

时间戳描述的是**某一条具体音频**，所以它只在写 `audio_url` 的同一处写入，换音频就作废：

- 配音脚本：persona 渲染写入；edge 渲染（整条不可分）删掉旧的。
- `build_bank` 全量重建的配音沿用：口播文本逐字没变才随 `audio_url` 一起接过来。
- `applyOriginalAudio` 挂原声：丢掉 TTS 留下的时间戳，改用清单条目自带的（没有就不带）。
- `lib/realBank.js`：只在有真实 `audio_url` 且整份通过体检时透传。

## 播放器（第 3 步，已落地）

- `components/listening/SentenceTranscript.js`：原文逐句渲染（存好的句子列表，不重切）；
  `AudioPlayer` 多了 `ref.playRange(start, end)` 与 `onTime` 回调。接线在历史页 `LADetail` / `LCDetail`
  （含真题练习记录、模考复盘卡）与练习模式的结果页（`ListeningMCQTask`，考试态不展示原文）。
  三个落历史的地方（listening / real-bank 页、AdaptiveExamShell）把 `sentence_timings` 随 `audio_url` 一起存进
  `details`。老记录（2026-09-18 之前做的）快照里没有这个键但有 `audio_url`：历史页按 `audio_url` 到题库里现查同一份
  （`lib/listening/timingsLookup.js`，题库 JSON 动态 import，只有打开这种老记录才拉，不进首屏包）；音频已不在题库里
  （题被下架 / 重配过）才按原样整段展示。
- 手势：**每句前面一个小播放键（▶）= 播放这一句；文字本身只管查词**（单击一个词、划词、双击都弹词典）。
  播放键带 `data-no-dict`，外层 WordLookupLayer 见到就跳过，因此一次点击只会有一个响应；
  文字上不再挂任何事件，听力原文和题干、阅读复盘的查词手势就此统一。
  （2026-09-19 前是「点句子 = 播放、划词 = 查词」，那样单击查词在听力原文里失效、手机上只能长按。）
- 词典弹窗：词落在某一句里（`data-sentence-index` + `data-sentence-playable="1"`）且调用方传了
  `onPlaySentence(index)` 时，弹窗发音钮旁多一颗「▶ 听这一句」，点它放那一句、弹窗保持打开。
  阅读等没传这个 prop 的调用方完全不受影响。
- seek 到 `start - SENTENCE_SEEK_LEAD_SEC`（60ms）：时间戳量的是 MP3 编码前的 WAV，MP3 编解码会带最多约 46ms
  的前置延迟（LAME 编码器 576 + 解码器 529 采样 @24kHz），浏览器不一定剥掉；上一句后面至少 120ms 静音，
  提前量吃不到上一句。
- 播到 `end` 停：主刹车是 `requestAnimationFrame` 轮询（`timeupdate` 粒度约 250ms，一句只有一两秒），
  `timeupdate` 作后台标签页的兜底。整段播放 / 续播会清掉句子刹车。
- 高亮跟着播放头走；落进句间静音（含一句刚放完）时留在上一句。
  点播某一句期间高亮**钉在被点的那一句**（`pinnedSentenceIndex`，范围 = start-0.5 ~ end+0.35）：ASR 对齐的时间戳常见
  上一句 end === 下一句 start，刹车停在 end 后十几毫秒时播放头已算进下一句，不钉的话高亮会在停下那一刻跳到没放的那句。
  出了范围（点继续 / 整段重播）自动放开。
- 播放键与句子首词包在同一个 `white-space: nowrap` 里（按钮是原子行内元素，前后天然是断行点，不粘住键会孤零零
  留在上一行行尾）。句子因此是两个文本节点，整句文本要按 `[data-sentence-index]` 的 textContent 取。
- 没有该字段、有字段但没有真实音频（TTS 兜底）、或体检不过 → 原文照常整段展示，只是没有逐句功能。
- 2026-09-18 真浏览器验证（合成 4 句 mp3 + 真实 LADetail，headless Chromium）：点第三句从 2.181s 起放、
  3.849s 停（end 3.84）；停后点「继续」续到结尾 5.016s 不再被掐；播放中点第一句跳回 0、1.213s 停。

## 体积

`text` 是原文再抄一遍，按现在的生成库估算（4640 句）整份约 660KB（lat 400 / lc 116 / la 97 / lcr 48）。
听力页是 `import` 静态 JSON 进客户端 bundle 的（app/listening/page.js），四个库现在共约 1.9MB，
全量补完会涨约三分之一。存量补齐（第 2 步）之前先拍板：接受，或把 `sentence_timings` 移到
`data/listening/timings/<type>.json` 这类 sidecar、只在打开原文时按需 fetch。契约不变，只是搬家。

## 个人题库（第 4 步，已落地）

个人题库的听力配音走 `/api/user-bank/render-audio`（edge-tts，逐段 / 逐轮合成后 mp3 **按字节拼接**）。
时间戳来自 Edge 报回来的 WordBoundary（`edgeTts.generateSpeechTimed`，100ns 刻度 → 秒，相对该段开头）：
各段的词按「前面各段的 mp3 帧时长之和」平移（`lib/tts/mp3Frames`，播放器就是按帧顺序解码的），
再与产线同一把刀切出来的句子做对齐（`alignSentences`）。对不上就不写，音频照常。
写回 `user_question_banks.data.sentence_timings`（JSONB，无需迁移），与 `audio_url` 同生同灭；
客户端 POST 自带的 `sentence_timings` 与 `audio_url` 一起被剥掉（`stripClientAudioUrl`），
读取时 `personalBank` 只在 `audio_url` 通过白名单且整份过体检时透传。

## 存量怎么补

产线只保证**新配的音频**自带时间戳。已上线的 753 条生成库 + 54 条真题 TTS 音频不重配，
用本地 faster-whisper 词级转写对齐（与真题原声同一套脚本），零 API 费用。
