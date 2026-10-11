# 单词发音后台预载

`preloadSpeakWords(words)` 在后台静默获取并加载整轮词条的 MP3，最多同时请求 3 个，不会播放音频，也不阻塞卡片展示。重复词条和重叠会话共享请求；返回的 `release()` 释放本轮引用，并取消已无人需要的请求。

首次进入时，首词的 MP3 通常尚未就绪。`speakWord` 此时立即沿用浏览器原生 TTS，不等待网络；后台 MP3 后续就绪不会补播同一个词。已就绪的词条直接播放缓存音频。只有收到真实播放事件才调用 `onStart`，未确认播放就结束按错误处理。

`GET /api/vocab/pronunciation?word=...&v=1` 复用免费 Edge TTS，输出固定 Aria 英语音色、-10% 语速的 MP3。接口校验英文词条，设限流、并发与缓存上限。网络或合成失败不阻塞复习；缓存未就绪时继续使用原生 TTS。浏览器拒绝自动播放时不会启动另一段原生语音重播。

闲置缓存最多保留 120 条；淘汰时卸载媒体并释放 Blob URL。取消播放会分离事件回调，迟到事件或播放失败不会重启已取消的发音。

## 服务端打包

`next.config.js` 将 `@andresaya/edge-tts` 列入 `experimental.serverComponentsExternalPackages`，使用原生 Node `require` 加载其 WebSocket 依赖。真实 Next dev 请求曾触发 `bufferUtil.mask is not a function`，普通 Node 合成正常；该配置针对两者打包差异。Next 14 官方支持 Route Handler 依赖退出自动打包，参见 [serverComponentsExternalPackages 文档](https://nextjs.org/docs/14/app/api-reference/next-config-js/serverComponentsExternalPackages)。配置变更后需重启服务验证。
