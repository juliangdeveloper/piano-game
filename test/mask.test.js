// test/mask.test.js — TDD para js/mask.js: detección dirigida por máscaras (R15)
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const Mask = require('../js/mask.js');

const SR = 48000;
const N = 4096;
const TAU = Math.PI * 2;

function sine(freq, amp = 0.5, phase = 0) {
  const buf = new Float32Array(N);
  for (let i = 0; i < N; i++) buf[i] = amp * Math.sin(TAU * freq * i / SR + phase);
  return buf;
}

function midiHz(m) { return 440 * Math.pow(2, (m - 69) / 12); }

test('M1: vocabulario 61 máscaras C2(midi 36)…C7(midi 96) — 61 teclas = CT-S1 completo', () => {
  assert.strictEqual(Mask.count(), 61);
  assert.strictEqual(Mask.minMidi(), 36);
  assert.strictEqual(Mask.maxMidi(), 96);
});

test('M2: seno A4 440 → score alto en A4, bajo en el resto', () => {
  const scores = Mask.scoreAll(sine(440), SR);
  const a4 = scores.get(69);
  assert.ok(a4 > 0.6, `A4 score=${a4}`);
  // vecino más cercano (A#4, 466Hz) debe quedar claramente abajo
  const aSharp = scores.get(70);
  assert.ok(aSharp < a4 * 0.3, `A#4=${aSharp} debe ser < 30% de A4`);
  // grave lejano (C3) casi nada
  assert.ok(scores.get(48) < 0.2, `C3=${scores.get(48)}`);
});

test('M3: A4 tocada con armónicos de piano (1, 0.5·2f, 0.25·3f, 0.12·4f) → A4 domina', () => {
  const buf = new Float32Array(N);
  const f = midiHz(69);
  const harmonics = [1, 0.5, 0.25, 0.12];
  for (let i = 0; i < N; i++) {
    let v = 0;
    for (let k = 0; k < harmonics.length; k++) {
      v += harmonics[k] * Math.sin(TAU * f * (k + 1) * i / SR);
    }
    buf[i] = v / 1.9;
  }
  const scores = Mask.scoreAll(buf, SR);
  assert.ok(scores.get(69) > 0.6, `A4 con armónicos=${scores.get(69)}`);
  const bestOther = Math.max(...[...scores.entries()].filter(([m]) => m !== 69).map(([, s]) => s));
  assert.ok(bestOther < scores.get(69) * 0.6, `mejor otra=${bestOther} < 60% de A4`);
});

test('M4: acorde C4+E4 simultáneos → ambos scores ≥ 0.45 (mitad física de energía; VOICE=0.6 solo, CHORD_MIN=0.45 acordes)', () => {
  const buf = new Float32Array(N);
  const fc = midiHz(60), fe = midiHz(64);
  for (let i = 0; i < N; i++) {
    buf[i] = 0.35 * Math.sin(TAU * fc * i / SR) + 0.35 * Math.sin(TAU * fe * i / SR);
  }
  const scores = Mask.scoreAll(buf, SR);
  assert.ok(scores.get(60) >= 0.45, `C4=${scores.get(60)}`);
  assert.ok(scores.get(64) >= 0.45, `E4=${scores.get(64)}`);
});

test('M5: ruido blanco → todos los scores < 0.3', () => {
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x3fffffff - 1; };
  const buf = new Float32Array(N);
  for (let i = 0; i < N; i++) buf[i] = rnd() * 0.3;
  const scores = Mask.scoreAll(buf, SR);
  let maxScore = 0;
  for (const [, s] of scores.entries()) maxScore = Math.max(maxScore, s);
  assert.ok(maxScore < 0.3, `max score=${maxScore}`);
});

test('M6: silencio → todos ~0 (sin excepciones)', () => {
  const scores = Mask.scoreAll(new Float32Array(N), SR);
  for (const [, s] of scores.entries()) assert.ok(s < 0.05, `score no nulo en silencio`);
});

test('M7: normalización interna — amplitud ×2 no cambia el score', () => {
  const a = Mask.scoreAll(sine(440, 0.3), SR);
  const b = Mask.scoreAll(sine(440, 0.6), SR);
  assert.ok(Math.abs(a.get(69) - b.get(69)) < 0.05, `0.3→${a.get(69)} vs 0.6→${b.get(69)}`);
});

test('M8: octave-like — seno puro A5 (880) activa A5, no A4 (penalización de subarmónicos)', () => {
  // el riesgo del score armónico: A4 (440) ve energía en 880 (su 2º armónico).
  // La ponderación 1/k y la exigencia de fundamental reducen el falso positivo.
  const scores = Mask.scoreAll(sine(880), SR);
  assert.ok(scores.get(81) > scores.get(69), `A5=${scores.get(81)} debe > A4=${scores.get(69)}`);
  assert.ok(scores.get(69) < 0.6, `falso A4=${scores.get(69)} debe quedar < 0.6`);
});