
const tf = require('@tensorflow/tfjs');
const { BasicPitch, outputToNotesPoly, noteFramesToTime, testables } = require('@spotify/basic-pitch');
const fs = require('fs');
function readWavMono(path) {
  const w = fs.readFileSync(path);
  let off = 12, fmt = null, data = null;
  while (off + 8 <= w.length) {
    const id = w.toString('ascii', off, off + 4);
    const sz = w.readUInt32LE(off + 4);
    if (id === 'fmt ') fmt = { ch: w.readUInt16LE(off+10), sr: w.readUInt32LE(off+12), bits: w.readUInt16LE(off+22) };
    if (id === 'data') { data = { off: off + 8, sz }; break; }
    off += 8 + sz + (sz % 2);
  }
  const n = Math.floor(data.sz / (fmt.bits/8) / fmt.ch);
  const audio = new Float32Array(n);
  for (let i = 0; i < n; i++) audio[i] = w.readInt16LE(data.off + i * (fmt.bits/8) * fmt.ch) / 32768;
  return { audio, sr: fmt.sr };
}
(async () => {
  await tf.setBackend('cpu'); await tf.ready();
  const MD = 'C:/Users/Rog/Workspace/01_PROYECTOS/piano-game/node_modules/@spotify/basic-pitch/model/';
  const mj = JSON.parse(fs.readFileSync(MD + 'model.json', 'utf-8'));
  const wd = fs.readFileSync(MD + 'group1-shard1of1.bin');
  const handler = tf.io.fromMemory({ modelTopology: mj.modelTopology, weightSpecs: mj.weightsManifest[0].weights, weightData: wd.buffer.slice(wd.byteOffset, wd.byteOffset + wd.byteLength) });
  const model = await tf.loadGraphModel(handler);
  const bp = new BasicPitch(Promise.resolve(model));
  let frames = [], onsets = [];
  let { audio } = readWavMono('C:/Users/Rog/Workspace/01_PROYECTOS/piano-game/tmp_test/piano-full-22050.wav');
  let peak = 0; for (let i=0;i<audio.length;i++) peak = Math.max(peak, Math.abs(audio[i]));
  const g = 0.9/peak; for (let i=0;i<audio.length;i++) audio[i] *= g;
  await bp.evaluateModel(audio, (f,o,c) => { frames = frames.concat(f); onsets = onsets.concat(o); }, () => {});
  // onsets crudos: contar picos > 0.3 por columna
  let onsetFrames = 0;
  for (let t = 0; t < onsets.length; t++) {
    let colMax = 0; for (let p = 0; p < onsets[t].length; p++) colMax = Math.max(colMax, onsets[t][p]);
    if (colMax > 0.3) onsetFrames++;
  }
  console.log('frames:', frames.length, 'frames con onset>0.3:', onsetFrames, '(esperado ~61 onsets x ~4 frames c/u = 244)');
  // frames con contenido
  let active = 0;
  for (let t = 0; t < frames.length; t++) {
    let colMax = 0; for (let p = 0; p < frames[t].length; p++) colMax = Math.max(colMax, frames[t][p]);
    if (colMax > 0.2) active++;
  }
  console.log('frames activos>0.2:', active, 'de', frames.length, `(${(100*active/frames.length).toFixed(0)}%)`);
  process.exit(0);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
