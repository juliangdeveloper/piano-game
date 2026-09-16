
const tf = require('@tensorflow/tfjs');
const { BasicPitch, outputToNotesPoly, noteFramesToTime, testables } = require('@spotify/basic-pitch');
const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
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
  const modelJSON = JSON.parse(fs.readFileSync(MD + 'model.json', 'utf-8'));
  const weightData = fs.readFileSync(MD + 'group1-shard1of1.bin');
  const artifacts = {
    modelTopology: modelJSON.modelTopology,
    weightSpecs: modelJSON.weightsManifest[0].weights,
    weightData: weightData.buffer.slice(weightData.byteOffset, weightData.byteOffset + weightData.byteLength)
  };
  const handler = tf.io.fromMemory(artifacts);
  const model = await tf.loadGraphModel(handler);
  console.log('modelo cargado ok');
  let { audio, sr } = readWavMono('C:/Users/Rog/Workspace/01_PROYECTOS/piano-game/tmp_test/julian-piano-22050.wav');
  // normalizar pico a 0.9 (grabación de voz memo = señal muy débil)
  let peak = 0;
  for (let i = 0; i < audio.length; i++) peak = Math.max(peak, Math.abs(audio[i]));
  console.log('pico original:', peak.toFixed(4));
  if (peak > 0) { const g = 0.9 / peak; for (let i = 0; i < audio.length; i++) audio[i] *= g; }
  console.log('audio:', (audio.length/sr).toFixed(1), 's @', sr);
  const bp = new BasicPitch(Promise.resolve(model));
  let frames = [], onsets = [], contours = [];
  const t0 = Date.now();
  await bp.evaluateModel(audio, (f, o, c) => { frames = frames.concat(f); onsets = onsets.concat(o); contours = contours.concat(c); }, () => {});
  console.log('inferencia:', ((Date.now()-t0)/1000).toFixed(1), 's (CPU wasm, sin node-native)');
  const notes = noteFramesToTime(outputToNotesPoly(frames, onsets, 0.25, 0.25, 3));
  console.log('notas:', notes.length);
  const NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const label = m => NAMES[m%12] + (Math.floor(m/12)-1);
  const pianoNotes = notes.filter(x => x.pitchMidi >= 33 && x.pitchMidi <= 100);
console.log('notas en rango piano:', pianoNotes.length);
console.log('secuencia:', pianoNotes.map(x => label(x.pitchMidi)).join(' '));
  // ground truth del sintético: C2..C7 ascendente (midi 36..96) + acordes C4E4G4 / F4A4C5
  const midis = new Set(pianoNotes.map(x => x.pitchMidi));
  console.log('midis únicos:', midis.size, 'rango:', Math.min(...midis), '-', Math.max(...midis));
  process.exit(0);
})().catch(e => { console.error('ERROR:', e.message, e.stack.split('\n')[1]||''); process.exit(1); });
