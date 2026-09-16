// gen-wav-full.js — CT-S1 completo: F2..F6 (61 notas midi 41..77) individuales + 2 acordes
// Tempo: 350ms por nota (rápido, exige el merge) + acordes finales de 1.2s
const SR = 48000;
const NOTE_MS = 350;
const GAP_MS = 60; // solape leve como pedal ligero
const notes = [];
for (let m = 36; m <= 96; m++) notes.push(m);
const chord1 = [60, 64, 67]; // Do mayor
const chord2 = [65, 69, 72]; // Fa mayor

let t = 0.2;
const events = [];
for (const m of notes) {
  events.push({ midi: m, t, dur: (NOTE_MS + GAP_MS) / 1000, amp: 0.42 });
  t += NOTE_MS / 1000;
}
t += 0.5;
const tChord1 = t;
for (const m of chord1) events.push({ midi: m, t, dur: 1.2, amp: 0.3 });
t += 1.6;
const tChord2 = t;
for (const m of chord2) events.push({ midi: m, t, dur: 1.2, amp: 0.3 });
const total = t + 1.4;

const N = Math.floor(SR * total);
const buf = new Float32Array(N);
const harm = [1, 0.5, 0.25, 0.12, 0.06, 0.03];
for (const ev of events) {
  const f0 = 440 * Math.pow(2, (ev.midi - 69) / 12);
  const i0 = Math.floor(ev.t * SR);
  const i1 = Math.min(N, Math.floor((ev.t + ev.dur) * SR));
  for (let i = i0; i < i1; i++) {
    const tt = (i - i0) / SR;
    const env = Math.min(1, tt * 50) * Math.exp(-tt * 2.0);
    let v = 0;
    for (let k = 0; k < harm.length; k++) v += harm[k] * Math.sin(2 * Math.PI * f0 * (k + 1) * tt);
    buf[i] += ev.amp * env * v / 1.96;
  }
}

const dataLen = N * 2, totalB = 44 + dataLen;
const w = Buffer.alloc(totalB);
w.write('RIFF', 0); w.writeUInt32LE(totalB - 8, 4); w.write('WAVE', 8);
w.write('fmt ', 12); w.writeUInt32LE(16, 16); w.writeUInt16LE(1, 20); w.writeUInt16LE(1, 22);
w.writeUInt32LE(SR, 24); w.writeUInt32LE(SR * 2, 28); w.writeUInt16LE(2, 32); w.writeUInt16LE(16, 34);
w.write('data', 36); w.writeUInt32LE(dataLen, 40);
for (let i = 0; i < N; i++) w.writeInt16LE(Math.round(Math.max(-1, Math.min(1, buf[i])) * 32767), 44 + i * 2);
require('fs').writeFileSync('piano-full.wav', w);
console.log(`piano-full.wav: ${notes.length} notas F2..F6 + 2 acordes, ${total.toFixed(1)}s, ${(totalB/1024/1024).toFixed(1)}MB`);
console.log(`esperado: 61 eventos individuales + ${chord1.length}+${chord2.length} voces de acorde = ${61+6} entradas (más duplicados de onset)`);