'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const Gate = require('../js/gate.js');

const SR = 48000;
const TAU = Math.PI * 2;

function sine(freq, amp) {
  const buf = new Float32Array(4096);
  for (let i = 0; i < buf.length; i++) buf[i] = amp * Math.sin(TAU * freq * i / SR);
  return buf;
}

function rmsDbfs(buf) {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  const rms = Math.sqrt(sum / buf.length);
  return 20 * Math.log10(rms + 1e-12);
}

test('G1: seno ampl 0.5 ≈ -6 dBFS (pico 0.5 → rms 0.354 → -9 dBFS ±0.5)', () => {
  const db = rmsDbfs(sine(440, 0.5));
  assert.ok(Math.abs(db - (-9.03)) < 0.5, `db=${db}`);
});

test('G2: gate -45 dBFS — silencio y ruido de fondo bajo → BLOQUEA; nota normal → PASA', () => {
  assert.strictEqual(Gate.passes(sine(440, 0.000001), -45), false);
  assert.strictEqual(Gate.passes(sine(440, 0.002), -45), false);
  assert.strictEqual(Gate.passes(sine(440, 0.05), -45), true);
  assert.strictEqual(Gate.passes(sine(440, 0.5), -45), true);
});

test('G3: histéresis — abierto cierra solo 8 dB por debajo del umbral de apertura', () => {
  const s = sine(440, 0.004);
  assert.strictEqual(Gate.passes(s, -45), false, 'cerrado: −48 < −45 bloquea');
  assert.strictEqual(Gate.isOpen(Gate.decide(s, -45, true)), true, 'abierto: −48 > −53 sigue pasando');
});

test('G4: decide retorna estado y señal de bloqueo coherentes', () => {
  const loud = sine(440, 0.4);
  const st1 = Gate.decide(loud, -45, false);
  assert.strictEqual(st1.open, true);
  assert.strictEqual(st1.passed, true);
  const silent = sine(440, 0.0001);
  const st2 = Gate.decide(silent, -45, true);
  assert.strictEqual(st2.open, false, '−80 < −53: cierra');
  assert.strictEqual(st2.passed, false);
});

test('G5: buffer de puros ceros → bloquea sin NaN', () => {
  const st = Gate.decide(new Float32Array(4096), -45, true);
  assert.strictEqual(st.passed, false);
  assert.strictEqual(Number.isFinite(st.db), true, `db=${st.db}`);
});

test('15: calibrateNoiseFloor — mediana de bloques + piso mínimo', () => {
  const noise = [];
  for (let i = 0; i < 20; i++) noise.push(-50);
  noise[2] = -25; noise[10] = -25; noise[18] = -25;
  const r = Gate.calibrateNoiseFloor(noise);
  assert.ok(Math.abs(r - (-50)) < 1, 'mediana de 20 bloques = -50, dio ' + r);
  const dead = [];
  for (let i = 0; i < 20; i++) dead.push(-120);
  assert.strictEqual(Gate.calibrateNoiseFloor(dead), -55);
});

