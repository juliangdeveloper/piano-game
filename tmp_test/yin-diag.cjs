
const Pitch = require('C:/Users/Rog/Workspace/01_PROYECTOS/piano-game/js/pitch.js');
const SR = 48000;
const N = 4096;
const TAU = Math.PI * 2;
const harm = [1, 0.5, 0.33, 0.25, 0.14];
function synth(freq, amp, snrNoise) {
  const buf = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    let v = 0;
    for (let k = 0; k < harm.length; k++) v += harm[k] * Math.sin(TAU * freq * (k+1) * t);
    buf[i] = amp * v / 2.2;
  }
  // ruido blanco a SNR dado
  let seed = 42;
  const rnd = () => { seed = (seed*1103515245+12345)&0x7fffffff; return seed/0x3fffffff-1; };
  if (snrNoise > 0) {
    let sigE = 0; for (let i=0;i<N;i++) sigE += buf[i]*buf[i];
    for (let i=0;i<N;i++) buf[i] += rnd()*snrNoise;
  }
  return buf;
}
const cases = [
  ['C4', 261.63, 0.4], ['E4', 329.63, 0.4], ['A4', 440, 0.4],
  ['E5', 659.26, 0.4], ['F5', 698.46, 0.4], ['G5', 783.99, 0.4], ['A5', 880, 0.4],
  ['C6', 1046.5, 0.4],
  // mismas agudas pero DÉBILES (como salen del speaker del CT-S1 al mic)
  ['E5 débil', 659.26, 0.06], ['G5 débil', 783.99, 0.06], ['A5 débil', 880, 0.06],
  ['E5 débil+ruido', 659.26, 0.06],
];
for (const [name, f, amp] of cases) {
  const r = Pitch.detectPitch(synth(f, amp, amp < 0.1 ? 0.004 : 0), SR, {});
  const note = r.freq ? Pitch.noteFromFreq(r.freq, 440) : null;
  console.log(`${name.padEnd(16)} freq=${r.freq ? r.freq.toFixed(1) : 'null'} claridad=${r.clarity.toFixed(3)} → ${note ? note.name+note.octave+' cents '+note.cents : '—'}`);
}
