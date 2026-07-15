# Azure Pronunciation Assessment — pilot spike

Validates whether Azure's Pronunciation Assessment can score the TOEFL speaking
**Listen and Repeat (repeat)** task: feed `audio + reference text` → get back
sentence / word / phoneme pronunciation scores + Prosody.

Two scripts + generated test audio. Nothing here touches `lib/speakingEval/`,
`app/api/`, or `components/` — it is an isolated spike.

| file | role |
|------|------|
| `scripts/azure-pa-make-clips.mjs` | generate test audio from official example sentences |
| `scripts/azure-pa-spike.mjs` | call Azure on each clip, dump raw JSON + a summary report |
| `data/claudeGen/spike-audio/` | generated clips + `manifest.json` (git-ignored, regenerable) |
| `data/claudeGen/reports/azure-pa-spike-*` | raw responses + summary (written only when a key is present) |

---

## TL;DR run order

```bash
# 1) one-time: install the small mp3 decoder (NOT saved to package.json; clips are git-ignored)
npm install --no-save mpg123-decoder

# 2) generate the test audio (needs network for edge-tts; ~30s)
node scripts/azure-pa-make-clips.mjs

# 3a) no Azure key yet → prints an onboarding guide and exits 0
node scripts/azure-pa-spike.mjs

# 3b) with AZURE_SPEECH_KEY + AZURE_SPEECH_REGION in .env.local → real run + reports
node scripts/azure-pa-spike.mjs
```

---

## Getting the Azure key (free F0 tier is enough)

1. **portal.azure.com** → *Create a resource* → search **"Speech service"**
   (a.k.a. *Azure AI Speech* / *Cognitive Services – Speech*).
2. **Pricing tier: F0 (Free)** — 5 audio hours/month, plenty for the spike.
   Pick a **Region** close to you, e.g. `eastus`, `eastasia`, `southeastasia`.
   The region ID becomes the host: `{region}.stt.speech.microsoft.com`.
3. After it deploys → the resource → **Keys and Endpoint** → copy **KEY 1** and
   the **Location/Region**.
4. Put them in **`.env.local`** (git-ignored):

   ```bash
   AZURE_SPEECH_KEY=<KEY 1>
   AZURE_SPEECH_REGION=<region id, e.g. southeastasia>
   ```

`AZURE_SPEECH_REGION` must be the region **id** (no spaces): `southeastasia`, not
"Southeast Asia".

### Cost note

F0 (Free) covers the spike. If this graduates to production, Pronunciation
Assessment bills on the standard **S0** Speech-to-Text meter (per audio-hour) —
one L&R utterance is a few seconds, so per-assessment cost is tiny; budget it as
`(#repeat submissions) × ~5s`. Confirm the current S0 rate for your region on the
Azure pricing page before committing.

---

## The REST call this spike makes

`POST https://{region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-US&format=detailed`

Headers:
- `Ocp-Apim-Subscription-Key: <key>`
- `Content-Type:` per audio format (see below)
- `Pronunciation-Assessment:` base64 of
  `{"ReferenceText": "...", "GradingSystem":"HundredMark", "Granularity":"Phoneme", "EnableMiscue":true, "EnableProsodyAssessment":true, "Dimension":"Comprehensive"}`
- Body: raw audio bytes.

Content-Type by format:
- WAV: `audio/wav; codecs=audio/pcm; samplerate=16000`
- Ogg/Opus: `audio/ogg; codecs=opus`
- WebM/Opus (browser-native): `audio/webm; codecs=opus` (the spike tries this to test acceptance)

---

## The three questions this spike exists to answer

### 1) Does webm/opus need transcoding?

The app records mic audio in the browser as **webm/opus** (`MediaRecorder`).
Azure REST short-audio historically accepts **WAV PCM** and **Ogg-Opus**, not
WebM. The spike ships:
- **WAV 16 kHz** clips (the safe, Azure-native format) — expected to be accepted.
- a **webm/opus** copy of each sentence — sent with `audio/webm; codecs=opus` to
  empirically record whether Azure takes it directly or returns an "unsupported
  format" error.

The real run fills in the answer in the report's "webm/opus transcoding" section.
**Expected outcome:** WAV accepted; webm needs a server-side transcode (to 16k WAV
or Ogg-Opus). The safest production path is to decode the browser blob to **16 kHz
mono PCM WAV** server-side (what these clips already are), or use the **Azure Speech
SDK** which ingests compressed audio via GStreamer.

### 2) What does `ReferenceText=""` (unscripted) return?

One clip (`unscripted.wav`, ~20s) is sent with an **empty ReferenceText**. The
report records the exact behavior: whether it succeeds, which scores come back
(Accuracy/Fluency/Prosody vs. Completeness), and whether Omission/Insertion error
types are absent (they require a reference). Note: the header keeps
`EnableMiscue:true`; if Azure rejects miscue-with-no-reference, the report flags
it and the follow-up is to retry that clip with `EnableMiscue:false`.

### 3) Full raw JSON shape

`azure-pa-spike-raw-<ts>.json` stores the complete response per clip
(`NBest[0].PronunciationAssessment`, `Words[].PronunciationAssessment.ErrorType`,
`Words[].Phonemes[].PronunciationAssessment.AccuracyScore`, etc.) — the ground
truth for wiring a real scorer.

---

## What the test clips are

5 official **Listen and Repeat** example sentences (short/medium/long) from
`data/speakingScoring/officialSamples.json`, each in 4 variants. For every variant
the **reference** handed to Azure is the ORIGINAL sentence; only the spoken audio
is mutated, so Azure's miscue machinery gets exercised:

| variant | mutation | expected Azure signal |
|---------|----------|-----------------------|
| A | clean read | high AccuracyScore, all `ErrorType=None` |
| B | 1–2 function words omitted | `ErrorType=Omission` on those words |
| C | 1 content word swapped | miscue (Omission of original + Insertion of substitute) |
| D | slowed −35% + 1 inserted word | `ErrorType=Insertion` + low/`-` ProsodyScore |

Plus `unscripted.wav` (empty reference).

### Empirical finding about the TTS basis (2026-07-16)

The free Edge "Read Aloud" endpoint that `lib/tts/edgeTts.js` rides only returns
audio for **mp3** and **webm/opus** here — `riff`/`raw`/`ogg` output formats come
back empty (verified across retries). So `make-clips` synthesizes **mp3**, decodes
it to PCM with the pure-WASM **mpg123-decoder**, resamples 24k→16k, and writes a
canonical WAV itself. (This is also why `edgeTts.js`'s `format:"wav"` path may not
work against the live free endpoint — worth a separate check.) No `ffmpeg` is
required or present.

### ⚠️ TTS limitation — read before trusting any score

The clips are **native-accent synthetic speech**. They validate:
- pipeline connectivity (auth, request shape, response parsing), and
- **omission / word-swap / insertion detection** (the miscue axis).

They do **NOT** validate how Azure scores real **L2 (non-native) pronunciation** —
the AccuracyScore/phoneme quality on actual accented speech. That requires real
learner recordings and is out of scope for a connectivity spike.

---

## Draft mapping: Azure signals → our official 0–5 Listen-and-Repeat band

Keyed to `data/speakingScoring/officialRubrics.json → listenAndRepeat`. This is a
**proposal**; `azure-pa-spike.mjs` applies it to each clip in the report so you can
sanity-check it against real numbers. Calibrate against real learner audio + human
L&R scores before shipping.

| band | official label | Azure rule (draft) |
|------|----------------|--------------------|
| 5 | exact repetition | 0 Omission/Insertion/Mispron **and** AccuracyScore ≥ ~92 **and** Completeness ≥ ~98 |
| 4 | meaning captured, not exact | ≥1 miscue but only 1–2 function words and/or ≤1 content word; meaning preserved |
| 3 | full sentence, meaning altered | ≥2 content omissions **or** ≥2 Mispronunciation **or** (1 content + ≥2 function omissions) |
| 2 | large portion missing | CompletenessScore < ~60 |
| 1 | minimal / unintelligible | CompletenessScore < ~30 **or** AccuracyScore < ~40 |
| 0 | no / irrelevant / no English | RecognitionStatus `NoMatch` or no English |

The mapping deliberately leans on **Completeness + miscue counts** (the L&R rubric
is about *faithful repetition*), with AccuracyScore as the intelligibility tie-break
— not on a single blended PronScore.

---

## Outputs

When a key is present, each run writes (timestamped) to `data/claudeGen/reports/`:
- `azure-pa-spike-raw-<ts>.json` — full raw response per clip.
- `azure-pa-spike-<ts>.md` — sentence-score table, per-clip word errors + lowest
  phonemes + draft band, the three-questions evidence section, and the mapping table.

Console prints one line per clip (`Pron=… Acc=… Prosody=…` or the HTTP error).
