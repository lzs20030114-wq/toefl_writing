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

## 播放器该怎么用（第 3 步）

- 时间戳量的是 MP3 编码前的 WAV。MP3 编解码会带最多约 46ms 的前置延迟（LAME 编码器 576 +
  解码器 529 采样 @24kHz），浏览器不一定剥掉，所以 seek 到 `start - SENTENCE_SEEK_LEAD_SEC`（60ms）。
  上一句后面至少有 120ms 静音，这个提前量吃不到上一句。
- 播到 `end` 停下：`timeupdate` 事件粒度约 250ms，用 `requestAnimationFrame` 轮询 `currentTime` 更准。
- 只在练习复盘 / 历史页开放；考试态不开放。
- 没有该字段、或体检不过 → 原文照常整段展示，只是没有逐句功能。

## 体积

`text` 是原文再抄一遍，按现在的生成库估算（4640 句）整份约 660KB（lat 400 / lc 116 / la 97 / lcr 48）。
听力页是 `import` 静态 JSON 进客户端 bundle 的（app/listening/page.js），四个库现在共约 1.9MB，
全量补完会涨约三分之一。存量补齐（第 2 步）之前先拍板：接受，或把 `sentence_timings` 移到
`data/listening/timings/<type>.json` 这类 sidecar、只在打开原文时按需 fetch。契约不变，只是搬家。

## 存量怎么补

产线只保证**新配的音频**自带时间戳。已上线的 753 条生成库 + 54 条真题 TTS 音频不重配，
用本地 faster-whisper 词级转写对齐（与真题原声同一套脚本），零 API 费用。
