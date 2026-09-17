// test/gate.test.js — TDD para js/gate.js: filtro de dB por RMS (R19: no buscar notas si no hay nada sonando)
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
  // silencio con ruido digital mínimo (-120 dBFS)
  assert.strictEqual(Gate.passes(sine(440, 0.000001), -45), false);
  // ruido de sala típico del mic iOS pre-filtros: ampl 0.002 (~-51 dBFS)
  assert.strictEqual(Gate.passes(sine(440, 0.002), -45), false);
  // nota tocada suave: ampl 0.05 (~-23 dBFS)
  assert.strictEqual(Gate.passes(sine(440, 0.05), -45), true);
  // nota normal 0.5 (-9 dBFS)
  assert.strictEqual(Gate.passes(sine(440, 0.5), -45), true);
});

test('G3: histéresis — abierto cierra solo 8 dB por debajo del umbral de apertura', () => {
  // señal a -41 dBFS (ampl ~0.009): con gate cerrado NO abre (−41 < −45+? no: −41 > −45 → abre)
  // mejor: umbral −45; señal a −48 dBFS: cerrado → bloquea; si estuviera abierto → pasa (cierra a −53)
  const s = sine(440, 0.004); // ≈ −48 dBFS
  assert.strictEqual(Gate.passes(s, -45), false, 'cerrado: −48 < −45 bloquea');
  // con estado abierto: histéresis −45−8 = −53 → −48 > −53 pasa
  assert.strictEqual(Gate.isOpen(Gate.decide(s, -45, true)), true, 'abierto: −48 > −53 sigue pasando');
});

test('G4: decide retorna estado y señal de bloqueo coherentes', () => {
  const loud = sine(440, 0.4);
  const st1 = Gate.decide(loud, -45, false);
  assert.strictEqual(st1.open, true);
  assert.strictEqual(st1.passed, true);
  const silent = sine(440, 0.0001); // −80 dBFS
  const st2 = Gate.decide(silent, -45, true); // estaba abierto
  assert.strictEqual(st2.open, false, '−80 < −53: cierra');
  assert.strictEqual(st2.passed, false);
});

test('G5: buffer de puros ceros → bloquea sin NaN', () => {
  const st = Gate.decide(new Float32Array(4096), -45, true);
  assert.strictEqual(st.passed, false);
  assert.strictEqual(Number.isFinite(st.db), true, `db=${st.db}`);
});

test('15: calibrateNoiseFloor — mediana de bloques + piso mínimo', () => {
  // 20 bloques de ruido -50 y 3 picos -25: la mediana debe dar el ruido de fondo
  const noise = [];
  for (let i = 0; i < 20; i++) noise.push(-50);
  noise[2] = -25; noise[10] = -25; noise[18] = -25;
  const r = Gate.calibrateNoiseFloor(noise);
  assert.ok(Math.abs(r - (-50)) < 1, 'mediana de 20 bloques = -50, dio ' + r);
  // piso absoluto: ambiente muerto (-120) no baja el umbral de -55
  const dead = [];
  for (let i = 0; i < 20; i++) dead.push(-120);
  assert.strictEqual(Gate.calibrateNoiseFloor(dead), -55);
});

