
const Pitch = require('C:/Users/Rog/Workspace/01_PROYECTOS/piano-game/js/pitch.js');
const SR = 48000, N = 4096, TAU = Math.PI*2;
// biquad highpass + lowpass Q 0.707 (implementación RBJ igual a Web Audio)
function makeBiquad(type, freq, Q, sr) {
  const w0 = 2*Math.PI*freq/sr, alpha = Math.sin(w0)/(2*Q), cosw = Math.cos(w0);
  let b0,b1,b2,a0,a1,a2;
  if (type==='highpass') { b0=(1+cosw)/2; b1=-(1+cosw); b2=(1+cosw)/2; a0=1+alpha; a1=-2*cosw; a2=1-alpha; }
  else { b0=(1-cosw)/2; b1=1-cosw; b2=(1-cosw)/2; a0=1+alpha; a1=-2*cosw; a2=1-alpha; }
  return { b0:b0/a0, b1:b1/a0, b2:b2/a0, a1:a1/a0, a2:a2/a0, x1:0,x2:0,y1:0,y2:0 };
}
function process(filt, buf) {
  const out = new Float32Array(buf.length);
  for (let i=0;i<buf.length;i++) {
    const x = buf[i];
    out[i] = filt.b0*x + filt.b1*filt.x1 + filt.b2*filt.x2 - filt.a1*filt.y1 - filt.a2*filt.y2;
    filt.x2=filt.x1; filt.x1=x; filt.y2=filt.y1; filt.y1=out[i];
  }
  return out;
}
const harm = [1, 0.5, 0.33, 0.25, 0.14];
function synth(freq, amp) {
  const buf = new Float32Array(N);
  for (let i=0;i<N;i++) {
    const t=i/SR; let v=0;
    for (let k=0;k<harm.length;k++) v += harm[k]*Math.sin(TAU*freq*(k+1)*t);
    buf[i]=amp*v/2.2;
  }
  return buf;
}
// escenario: CT-S1 speaker con rolloff real — agudos con -12dB y armónicos altos atenuados
function synthRolloff(freq, amp) {
  const buf = new Float32Array(N);
  const harmRolled = [0.6, 0.35, 0.18, 0.08, 0.03]; // agudos más tenues
  for (let i=0;i<N;i++) {
    const t=i/SR; let v=0;
    for (let k=0;k<harmRolled.length;k++) v += harmRolled[k]*Math.sin(TAU*freq*(k+1)*t);
    buf[i]=amp*v/1.24;
  }
  return buf;
}
const hp = makeBiquad('highpass', 60, 0.707, SR);
const lp = makeBiquad('lowpass', 4000, 0.707, SR);
const cases = [
  ['E5 normal+cadena', 659.26, 0.4, synth],
  ['G5 normal+cadena', 783.99, 0.4, synth],
  ['A5 normal+cadena', 880, 0.4, synth],
  ['E5 rolloff+cadena', 659.26, 0.25, synthRolloff],
  ['G5 rolloff+cadena', 783.99, 0.25, synthRolloff],
  ['A5 rolloff+cadena', 880, 0.25, synthRolloff],
  ['C5 rolloff+cadena', 523.25, 0.25, synthRolloff],
  ['C6 rolloff+cadena', 1046.5, 0.25, synthRolloff],
];
for (const [name, f, amp, gen] of cases) {
  let buf = gen(f, amp);
  buf = process(lp, process(hp, buf)); // cadena R8
  const r = Pitch.detectPitch(buf, SR, {});
  const note = r.freq ? Pitch.noteFromFreq(r.freq, 440) : null;
  console.log(`${name.padEnd(20)} freq=${r.freq?r.freq.toFixed(1):'null'} claridad=${r.clarity.toFixed(3)} → ${note?note.name+note.octave:'—'}`);
}
