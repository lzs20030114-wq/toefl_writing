/* ============================================================
   宣传片背景音乐合成器 — 120 BPM (beat=0.5s, bar=2s), 58s
   结构与视频时间轴对齐:
     0-4    intro: pad + riser(2-4)
     4      DROP1 (crash): kick4/4 + bass   ← S1 题目
     12     hats + clap 加入                ← S2 作答
     22-26  breakdown(无鼓) + riser(24-26)  ← S3 AI 分析
     26     DROP2 (crash): 全套 + 琶音      ← S4 评分
     48     收束: 鼓渐出                    ← S7 CTA
     52     终止和弦 + crash, 55.5-57.5 淡出
   ============================================================ */
const fs = require("fs");
const SR = 44100, DUR = 66, N = SR * DUR;
const L = new Float32Array(N), R = new Float32Array(N);
const m2f = m => 440 * Math.pow(2, (m - 69) / 12);

function mix(i, l, r) { if (i >= 0 && i < N) { L[i] += l; R[i] += r; } }

/* 正弦音色（可加谐波/失谐），ADSR 简化为 attack + exp release */
function tone(t0, dur, freq, amp, { det = 0, pan = 0, atk = 0.01, rel = 0.15, h2 = 0, h3 = 0 } = {}) {
  const s0 = Math.floor(t0 * SR), n = Math.floor((dur + rel) * SR);
  const f = freq * Math.pow(2, det / 1200);
  const gl = Math.SQRT1_2 * (1 - pan), gr = Math.SQRT1_2 * (1 + pan);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let e = t < atk ? t / atk : t < dur ? 1 : Math.exp(-(t - dur) / (rel * 0.4));
    const ph = 2 * Math.PI * f * t;
    let v = Math.sin(ph) + h2 * Math.sin(2 * ph) + h3 * Math.sin(3 * ph);
    v *= amp * e;
    mix(s0 + i, v * gl, v * gr);
  }
}

/* 柔和 pad：每个音 2 个失谐声部 + 慢起音 */
function pad(t0, midis, dur = 2.05, amp = 0.030) {
  midis.forEach((m, k) => {
    const pan = (k / (midis.length - 1) - 0.5) * 0.7;
    tone(t0, dur, m2f(m), amp, { det: +4, pan, atk: 0.35, rel: 0.9, h2: 0.12 });
    tone(t0, dur, m2f(m), amp, { det: -4, pan: -pan, atk: 0.4, rel: 0.9 });
  });
}

function bass(t0, midi, dur = 0.42, amp = 0.20) {
  tone(t0, dur, m2f(midi), amp, { atk: 0.006, rel: 0.1, h2: 0.35, h3: 0.1 });
}

function kick(t0) {
  const s0 = Math.floor(t0 * SR), n = Math.floor(0.16 * SR);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = 42 + 95 * Math.exp(-t / 0.028);
    const v = Math.sin(2 * Math.PI * f * t) * 0.82 * Math.exp(-t / 0.055);
    mix(s0 + i, v, v);
  }
}

let seed = 1;
function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x40000000 - 1; }

function hat(t0, amp = 0.085) {
  const s0 = Math.floor(t0 * SR), n = Math.floor(0.045 * SR);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const w = rnd(); const hp = w - prev; prev = w; /* 一阶高通 */
    const v = hp * amp * Math.exp(-t / 0.013);
    mix(s0 + i, v * 0.8, v * 1.1);
  }
}

function clap(t0, amp = 0.24) {
  [0, 0.011, 0.023].forEach((off, k) => {
    const s0 = Math.floor((t0 + off) * SR), n = Math.floor(0.10 * SR);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const w = rnd(); lp += (w - lp) * 0.25; /* 低通近似 band 感 */
      const v = (w - lp) * amp * (k === 2 ? 1 : 0.5) * Math.exp(-t / 0.03);
      mix(s0 + i, v * 1.05, v * 0.85);
    }
  });
}

function pluck(t0, midi, amp = 0.062, pan = 0) {
  tone(t0, 0.1, m2f(midi), amp, { atk: 0.003, rel: 0.22, h2: 0.4, h3: 0.12, pan });
}

function riser(t0, dur, amp = 0.085) {
  const s0 = Math.floor(t0 * SR), n = Math.floor(dur * SR);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR, p = t / dur;
    const w = rnd();
    const a = 0.04 + 0.96 * p; /* 滤波逐渐打开 */
    lp += (w - lp) * a;
    const v = lp * amp * p * p;
    mix(s0 + i, v * (1 - 0.3 * Math.sin(p * 9)), v * (1 + 0.3 * Math.sin(p * 9)));
  }
}

function crash(t0, amp = 0.16) {
  const s0 = Math.floor(t0 * SR), n = Math.floor(1.3 * SR);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const w = rnd(); const hp = w - prev; prev = w;
    const v = hp * amp * Math.exp(-t / 0.38);
    mix(s0 + i, v * 0.9, v * 1.1);
  }
}

/* ---------- 编曲 ---------- */
const Am9   = [45, 52, 60, 64, 71];
const Fmaj7 = [41, 48, 57, 60, 64];
const Cmaj9 = [48, 55, 59, 62, 67];
const Gadd9 = [43, 50, 59, 62, 69];
const PROG  = [Am9, Fmaj7, Cmaj9, Gadd9];
const ROOT  = [33, 29, 36, 31];

/* pads: 前两小节 Am9，4s 起进行循环到 52 */
pad(0, Am9); pad(2, Am9, 2.05, 0.034);
for (let t = 4; t < 58; t += 2) {
  const k = ((t - 4) / 2) % 4;
  pad(t, PROG[k], 2.05, t >= 20 ? 0.036 : 0.031);
}
/* 终止和弦：大 Am9 长音 (58s CTA) */
pad(58, [33, 45, 52, 60, 64, 71, 76], 4.5, 0.05);
bass(58, 33, 2.4, 0.2);

/* bass groove: 4-20 与 24-52；breakdown(20-24) 只留小节头 */
for (let bar = 4; bar < 58; bar += 2) {
  const k = ((bar - 4) / 2) % 4, r = ROOT[k];
  if (bar >= 16 && bar < 20) { bass(bar, r, 1.2, 0.16); continue; }
  bass(bar, r, 0.55, 0.21);
  bass(bar + 0.75, r, 0.16, 0.13);
  bass(bar + 1.0, r + 12, 0.3, 0.12);
  bass(bar + 1.5, r, 0.4, 0.18);
}

/* kick 4/4: 4-20, 24-52 */
for (let t = 4; t < 16; t += 0.5) kick(t);
for (let t = 20; t < 58; t += 0.5) kick(t);

/* hats 反拍: 12-52 (breakdown 保留维持脉冲) */
for (let t = 10.25; t < 58; t += 0.5) hat(t, t < 16 ? 0.075 : 0.09);

/* clap 2/4 拍: 12-20, 24-52 */
for (let bar = 10; bar < 16; bar += 1) clap(bar + 0.5, 0.2);
for (let bar = 20; bar < 58; bar += 1) clap(bar + 0.5, 0.24);

/* 琶音 8 分音符: 24-32 (评分 drop) 与 40-52 (词汇+范文) */
function arpRange(t0, t1) {
  const pat = [0, 1, 2, 3, 2, 1, 0, 2];
  for (let t = t0; t < t1; t += 0.25) {
    const k = Math.floor((t - 4) / 2) % 4;
    const ch = PROG[k];
    const idx = Math.round((t - t0) / 0.25) % 8;
    const note = ch[1 + pat[idx] % (ch.length - 1)] + 12;
    pluck(t, note, 0.05, Math.sin(t * 2.1) * 0.5);
  }
}
arpRange(20, 28); arpRange(34, 58);

/* risers & crashes 对齐场景切换 4/12/20/24/32/40/46/52 */
riser(2, 2, 0.09); riser(18, 2, 0.11); riser(56, 2, 0.07);
crash(4, 0.13); crash(10, 0.1); crash(16, 0.11); crash(20, 0.17); crash(26.5, 0.1);
crash(34, 0.12); crash(40, 0.12); crash(47, 0.1); crash(52, 0.14); crash(58, 0.2);

/* ---------- 母带: 软限幅 + 收尾淡出 + 归一化 ---------- */
const FADE0 = 63.5 * SR, FADE1 = 65.5 * SR;
let peak = 0;
for (let i = 0; i < N; i++) {
  L[i] = Math.tanh(L[i] * 1.25); R[i] = Math.tanh(R[i] * 1.25);
  if (i > FADE0) { const g = Math.max(0, 1 - (i - FADE0) / (FADE1 - FADE0)); L[i] *= g; R[i] *= g; }
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const g = 0.88 / peak;

/* ---------- 写 16-bit WAV ---------- */
const data = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) {
  data.writeInt16LE(Math.round(L[i] * g * 32767), i * 4);
  data.writeInt16LE(Math.round(R[i] * g * 32767), i * 4 + 2);
}
const hdr = Buffer.alloc(44);
hdr.write("RIFF", 0); hdr.writeUInt32LE(36 + data.length, 4); hdr.write("WAVE", 8);
hdr.write("fmt ", 12); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(2, 22);
hdr.writeUInt32LE(SR, 24); hdr.writeUInt32LE(SR * 4, 28); hdr.writeUInt16LE(4, 32); hdr.writeUInt16LE(16, 34);
hdr.write("data", 36); hdr.writeUInt32LE(data.length, 40);
fs.writeFileSync("/tmp/promo-rec/music.wav", Buffer.concat([hdr, data]));
console.log("music.wav written:", ((44 + data.length) / 1e6).toFixed(1), "MB, peak-normalized", g.toFixed(2));
