// test/pitch.test.js — tests Node (assert nativo, sin deps) para js/pitch.js
// TDD: escritos ANTES de la implementación.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const Pitch = require(path.join(__dirname, '..', 'js', 'pitch.js'));

const N = 4096;
const TAU = Math.PI * 2;

// --- helpers ---------------------------------------------------------------

// Seno puro en un buffer de N muestras
function sine(freq, sampleRate, n = N) {
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) buf[i] = Math.sin(TAU * freq * i / sampleRate);
  return buf;
}

// Señal tipo piano: fundamental + armónicos
function pianoTone(freq, sampleRate, n = N) {
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    buf[i] = Math.sin(TAU * freq * t)
      + 0.5 * Math.sin(TAU * 2 * freq * t)
      + 0.25 * Math.sin(TAU * 3 * freq * t)
      + 0.12 * Math.sin(TAU * 4 * freq * t);
  }
  return buf;
}

// Ruido blanco determinista: LCG con semilla fija (Park–Miller)
function whiteNoise(seed, n = N) {
  const buf = new Float32Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s = (s * 48271) % 2147483647;
    buf[i] = (s / 2147483647) * 2 - 1;
  }
  return buf;
}

// --- tests -----------------------------------------------------------------

test('1: seno 440 Hz @48000 → A4, claridad > 0.9, cents 0±2', () => {
  const { freq, clarity } = Pitch.detectPitch(sine(440, 48000), 48000);
  assert.ok(freq !== null, 'freq no debe ser null');
  assert.ok(Math.abs(freq - 440) <= 1.5, `freq=${freq}, esperaba 440±1.5`);
  assert.ok(clarity > 0.9, `claridad=${clarity}, esperaba > 0.9`);
  const note = Pitch.noteFromFreq(freq);
  assert.strictEqual(note.name, 'A');
  assert.strictEqual(note.octave, 4);
  assert.ok(Math.abs(note.cents) <= 2, `cents=${note.cents}, esperaba 0±2`);
});

test('2: seno 261.6256 Hz @44100 → C4', () => {
  const { freq } = Pitch.detectPitch(sine(261.6256, 44100), 44100);
  assert.ok(freq !== null, 'freq no debe ser null');
  assert.ok(Math.abs(freq - 261.6256) <= 1.5, `freq=${freq}, esperaba 261.6256±1.5`);
  const note = Pitch.noteFromFreq(freq);
  assert.strictEqual(note.name, 'C');
  assert.strictEqual(note.octave, 4);
});

test('3: seno 82.4069 Hz → E2', () => {
  const { freq } = Pitch.detectPitch(sine(82.4069, 48000), 48000);
  assert.ok(freq !== null, 'freq no debe ser null');
  assert.ok(Math.abs(freq - 82.4069) <= 2, `freq=${freq}, esperaba 82.4069±2`);
  const note = Pitch.noteFromFreq(freq);
  assert.strictEqual(note.name, 'E');
  assert.strictEqual(note.octave, 2);
});

test('4: seno 2093.0 Hz → C7', () => {
  const { freq } = Pitch.detectPitch(sine(2093.0, 48000), 48000);
  assert.ok(freq !== null, 'freq no debe ser null');
  assert.ok(Math.abs(freq - 2093.0) <= 3, `freq=${freq}, esperaba 2093±3`);
  const note = Pitch.noteFromFreq(freq);
  assert.strictEqual(note.name, 'C');
  assert.strictEqual(note.octave, 7);
});

test('5: señal tipo piano 220 Hz → A3, claridad > 0.9', () => {
  const { freq, clarity } = Pitch.detectPitch(pianoTone(220, 48000), 48000);
  assert.ok(freq !== null, 'freq no debe ser null');
  assert.ok(Math.abs(freq - 220) <= 2, `freq=${freq}, esperaba 220±2`);
  assert.ok(clarity > 0.9, `claridad=${clarity}, esperaba > 0.9`);
  const note = Pitch.noteFromFreq(freq);
  assert.strictEqual(note.name, 'A');
  assert.strictEqual(note.octave, 3);
});

test('6: buffer de ceros → freq null, claridad ≤ 0.1', () => {
  const { freq, clarity } = Pitch.detectPitch(new Float32Array(N), 48000);
  assert.strictEqual(freq, null);
  assert.ok(clarity <= 0.1, `claridad=${clarity}, esperaba ≤ 0.1`);
});

test('7: ruido blanco (LCG seed fija) → sin periodicidad: claridad baja (v1.3.1: freq se reporta, el gate es política de app)', () => {
  const { clarity } = Pitch.detectPitch(whiteNoise(12345), 48000);
  assert.ok(clarity < 0.5, `claridad=${clarity}, ruido debe quedar muy bajo el umbral 0.90`);
});

test('8: buffer de 100 muestras → freq null sin lanzar excepción', () => {
  const buf = new Float32Array(100);
  for (let i = 0; i < 100; i++) buf[i] = Math.sin(TAU * 440 * i / 48000);
  assert.doesNotThrow(() => {
    const { freq } = Pitch.detectPitch(buf, 48000);
    assert.strictEqual(freq, null);
  });
});

test('9: hzForNote A4 = 440; hzForNote C4 @442 ≈ 262.81 (12-TET)', () => {
  assert.strictEqual(Pitch.hzForNote('A', 4), 440);
  const c4 = Pitch.hzForNote('C', 4, 442);
  // SPEC decía ≈263.74, pero 12-TET da 442·2^(-9/12) ≈ 262.8148.
  // 263.74 no corresponde a ningún intervalo temperado de A4=442.
  assert.ok(Math.abs(c4 - 262.81477241560134) <= 0.05, `hzForNote(C,4,442)=${c4}`);
  const c4Ref = Pitch.hzForNote('C', 4);
  assert.ok(Math.abs(c4Ref - 261.6256) <= 0.01, `hzForNote(C,4)=${c4Ref}`);
});

test('10: roundtrip hzForNote → noteFromFreq para C2..C7, |cents| ≤ 1', () => {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  for (let oct = 2; oct <= 7; oct++) {
    for (const name of names) {
      const hz = Pitch.hzForNote(name, oct);
      const note = Pitch.noteFromFreq(hz);
      assert.deepStrictEqual(
        { name: note.name, octave: note.octave },
        { name, octave: oct },
        `roundtrip falló para ${name}${oct}`
      );
      assert.ok(Math.abs(note.cents) <= 1, `${name}${oct}: cents=${note.cents}, esperaba ≤1`);
    }
  }
});

test('11: noteFromFreq(444.5) → A4, cents ≈ +18 (±5)', () => {
  const note = Pitch.noteFromFreq(444.5);
  assert.strictEqual(note.name, 'A');
  assert.strictEqual(note.octave, 4);
  assert.ok(Math.abs(note.cents - 18) <= 5, `cents=${note.cents}, esperaba ≈18±5`);
});

test('12: noteFromMidi — C4=60, A4=69, extremos 0/127, fuera de rango → null (R13)', () => {
  const c4 = Pitch.noteFromMidi(60);
  assert.deepStrictEqual(
    { name: c4.name, octave: c4.octave, cents: c4.cents, midi: c4.midi },
    { name: 'C', octave: 4, cents: 0, midi: 60 }
  );
  const a4 = Pitch.noteFromMidi(69);
  assert.deepStrictEqual(
    { name: a4.name, octave: a4.octave, cents: a4.cents, midi: a4.midi },
    { name: 'A', octave: 4, cents: 0, midi: 69 }
  );
  const low = Pitch.noteFromMidi(0);
  assert.deepStrictEqual({ name: low.name, octave: low.octave }, { name: 'C', octave: -1 });
  const hi = Pitch.noteFromMidi(127);
  assert.deepStrictEqual({ name: hi.name, octave: hi.octave }, { name: 'G', octave: 9 });
  assert.strictEqual(Pitch.noteFromMidi(128), null, '128 fuera de rango');
  assert.strictEqual(Pitch.noteFromMidi(-1), null, '-1 fuera de rango');
  assert.strictEqual(Pitch.noteFromMidi('60'), null, 'string no es midi válido');
});

test('13: roundtrip noteFromMidi ↔ noteFromFreq en todo el rango MIDI', () => {
  for (let m = 0; m <= 127; m++) {
    const byMidi = Pitch.noteFromMidi(m);
    const hz = Pitch.hzForNote(byMidi.name, byMidi.octave);
    const byFreq = Pitch.noteFromFreq(hz);
    assert.strictEqual(byFreq.midi, m, `midi ${m}: ${byMidi.name}${byMidi.octave} → ${hz}Hz → volvió ${byFreq.midi}`);
  }
});

test('14: clarifyThresholdForMidi — 0.90 graves/C5-, 0.78 agudos C5+ (rolloff de speaker)', () => {
  assert.strictEqual(Pitch.clarifyThresholdForMidi(48), 0.90); // C3
  assert.strictEqual(Pitch.clarifyThresholdForMidi(71), 0.90); // B4: aún estricto
  assert.strictEqual(Pitch.clarifyThresholdForMidi(72), 0.78); // C5: primero en fallar
  assert.strictEqual(Pitch.clarifyThresholdForMidi(76), 0.78); // E5
  assert.strictEqual(Pitch.clarifyThresholdForMidi(81), 0.78); // A5
  assert.strictEqual(Pitch.clarifyThresholdForMidi(96), 0.78); // C7
  // opts override gana
  assert.strictEqual(Pitch.clarifyThresholdForMidi(72, { strict: 0.95, relaxed: 0.85 }), 0.85);
});
