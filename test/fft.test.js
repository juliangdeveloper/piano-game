// test/fft.test.js — TDD para js/fft.js (radix-2, espectro de magnitud con Hann)
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const FFT = require('../js/fft.js');

const SR = 48000;
const N = 4096;
const TAU = Math.PI * 2;

function sine(freq, amp = 0.5) {
  const buf = new Float32Array(N);
  for (let i = 0; i < N; i++) buf[i] = amp * Math.sin(TAU * freq * i / SR);
  return buf;
}

test('FFT1: seno 440 Hz → pico de magnitud en bin 37 o 38 (440/48000*4096=37.5)', () => {
  const mag = FFT.magnitudeSpectrum(sine(440));
  let best = 0, bestV = -1;
  for (let k = 1; k < mag.length; k++) {
    if (mag[k] > bestV) { bestV = mag[k]; best = k; }
  }
  assert.ok(best === 37 || best === 38, `pico en bin ${best}, esperaba 37-38`);
  assert.ok(bestV > 0, 'magnitud positiva');
});

test('FFT2: seno 261.63 Hz (C4) → pico en bin 22 (22.33)', () => {
  const mag = FFT.magnitudeSpectrum(sine(261.6256));
  let best = 0, bestV = -1;
  for (let k = 1; k < mag.length; k++) {
    if (mag[k] > bestV) { bestV = mag[k]; best = k; }
  }
  assert.ok(best === 22 || best === 23, `pico en bin ${best}, esperaba 22-23`);
});

test('FFT3: silencio → espectro ~cero (energía total < 1e-6)', () => {
  const mag = FFT.magnitudeSpectrum(new Float32Array(N));
  let sum = 0;
  for (let k = 0; k < mag.length; k++) sum += mag[k] * mag[k];
  assert.ok(sum < 1e-6, `energía=${sum}`);
});

test('FFT4: Parseval (DFT sin normalizar) — Σ2|X[k]|² ≈ N·mean(w²)·Σ|x[n]|² (±10%)', () => {
  const buf = sine(440);
  let timeE = 0;
  for (let i = 0; i < N; i++) timeE += buf[i] * buf[i];
  const mag = FFT.magnitudeSpectrum(buf);
  let freqE = 0;
  for (let k = 0; k < mag.length; k++) freqE += 2 * mag[k] * mag[k];
  const w = FFT.hann(N);
  let wE = 0;
  for (let i = 0; i < N; i++) wE += w[i] * w[i];
  const expected = N * (wE / N) * timeE; // N·mean(w²)·energía temporal
  const ratio = freqE / expected;
  assert.ok(ratio > 0.9 && ratio < 1.1, `freqE=${freqE}, esperaba ≈${expected.toFixed(1)}, ratio=${ratio.toFixed(3)}`);
});

test('FFT5: tamaño no potencia de 2 → lanza error', () => {
  assert.throws(() => FFT.magnitudeSpectrum(new Float32Array(4095)));
});

test('FFT6: magnitud es determinista (misma entrada, mismo espectro)', () => {
  const a = FFT.magnitudeSpectrum(sine(440));
  const b = FFT.magnitudeSpectrum(sine(440));
  assert.deepStrictEqual(Array.from(a), Array.from(b));
});