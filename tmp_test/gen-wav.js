// gen-wav.js — genera piano-test.wav: C4(0-0.8s) E4(0.8-1.6) G4(1.6-2.4) C5(2.4-3.2), acorde C4+E4 (3.2-4.2), silencio
const { execSync } = require('child_process');
const SR = 48000;
const N = Math.floor(SR * 4.6);
const buf = new Float32Array(N);

function addNote(midi, tStart, dur, amp = 0.5) {
  const f0 = 440 * Math.pow(2, (midi - 69) / 12);
  const i0 = Math.floor(tStart * SR);
  const i1 = Math.min(N, Math.floor((tStart + dur) * SR));
  const harm = [1, 0.5, 0.25, 0.12, 0.06];
  for (let i = i0; i < i1; i++) {
    const t = (i - i0) / SR;
    const env = Math.min(1, t * 40) * Math.exp(-t * 2.2); // ataque + decay de piano
    let v = 0;
    for (let k = 0; k < harm.length; k++) {
      v += harm[k] * Math.sin(2 * Math.PI * f0 * (k + 1) * t);
    }
    buf[i] += amp * env * v / 1.93;
  }
}

addNote(60, 0.0, 0.8);   // C4
addNote(64, 0.8, 0.8);   // E4
addNote(67, 1.6, 0.8);   // G4
addNote(72, 2.4, 0.8);   // C5
addNote(60, 3.2, 1.0, 0.35); // acorde C4
addNote(64, 3.2, 1.0, 0.35); // + E4

// WAV 16-bit mono
const dataLen = N * 2;
const total = 44 + dataLen;
const w = Buffer.alloc(total);
w.write('RIFF', 0); w.writeUInt32LE(total - 8, 4); w.write('WAVE', 8);
w.write('fmt ', 12); w.writeUInt32LE(16, 16); w.writeUInt16LE(1, 20); w.writeUInt16LE(1, 22);
w.writeUInt32LE(SR, 24); w.writeUInt32LE(SR * 2, 28); w.writeUInt16LE(2, 32); w.writeUInt16LE(16, 34);
w.write('data', 36); w.writeUInt32LE(dataLen, 40);
for (let i = 0; i < N; i++) {
  let s = Math.max(-1, Math.min(1, buf[i]));
  w.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
}
require('fs').writeFileSync('piano-test.wav', w);
console.log('WAV escrito:', (total/1024).toFixed(0), 'KB — C4 E4 G4 C5 + acorde C4E4, 4.6s');