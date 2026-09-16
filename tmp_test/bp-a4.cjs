
const tf = require('@tensorflow/tfjs');
const { BasicPitch, outputToNotesPoly, noteFramesToTime } = require('@spotify/basic-pitch');
const fs = require('fs');
const SR = 22050;
// A4 = 440Hz, 3 segundos, amplitud 0.7, con armónicos de piano
const N = SR * 3;
const audio = new Float32Array(N);
const harm = [1, 0.5, 0.33, 0.25, 0.14];
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const env = Math.min(1, t * 30) * Math.exp(-t * 1.5);
  let v = 0;
  for (let k = 0; k < harm.length; k++) v += harm[k] * Math.sin(2 * Math.PI * 440 * (k+1) * t);
  audio[i] = 0.7 * env * v / 2.2;
}
(async () => {
  await tf.setBackend('cpu'); await tf.ready();
  const MD = 'C:/Users/Rog/Workspace/01_PROYECTOS/piano-game/node_modules/@spotify/basic-pitch/model/';
  const mj = JSON.parse(fs.readFileSync(MD + 'model.json', 'utf-8'));
  const wd = fs.readFileSync(MD + 'group1-shard1of1.bin');
  const handler = tf.io.fromMemory({ modelTopology: mj.modelTopology, weightSpecs: mj.weightsManifest[0].weights, weightData: wd.buffer.slice(wd.byteOffset, wd.byteOffset + wd.byteLength) });
  const model = await tf.loadGraphModel(handler);
  const bp = new BasicPitch(Promise.resolve(model));
  let frames, onsets;
  await bp.evaluateModel(audio, (f,o,c) => { frames=f; onsets=o; }, () => {});
  const notes = noteFramesToTime(outputToNotesPoly(frames, onsets, 0.25, 0.25, 3));
  console.log('A4=440Hz → notas:', notes.map(x => `midi${x.pitchMidi} @${x.startTimeSeconds.toFixed(1)}s`).join(', '));
  process.exit(0);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
