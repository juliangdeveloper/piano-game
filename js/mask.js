// js/mask.js — Detección dirigida por máscaras (R15): una máscara por nota del
// vocabulario F2..F6 (61 máscaras). Cada máscara pregunta "¿estás tú aquí?"
// sumando energía espectral en fundamental + armónicos, ponderada 1/k y con
// penalización de subarmónicos para no confundir A5 con A4.
// Pura, sin DOM. UMD: module.exports (Node) + window.Mask (browser).
'use strict';

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Mask = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var FFT = (typeof module === 'object' && module.exports)
    ? require('./fft.js')
    : (root.FFT || null);

  var MIN_MIDI = 36; // C2 (84 máscaras C2..C7 — dial Julián: 84)
  var MAX_MIDI = 96; // C7
  var NUM_HARMONICS = 8;
  var A4 = 440;

  var _masks = null;
  var _calByRate = {}; // calibración por sampleRate (seno puro → score 1.0)

  function midiHz(m, a4) {
    return (a4 || A4) * Math.pow(2, (m - 69) / 12);
  }

  /**
   * Construye (una vez) las máscaras: por nota, lista de bins FFT
   * con su peso (1/k para fundamental..armónico k, banda ±1 bin).
   */
  function buildMasks(sampleRate, n) {
    var half = n >> 1;
    var binHz = sampleRate / n;
    var masks = new Map();
    for (var m = MIN_MIDI; m <= MAX_MIDI; m++) {
      var f0 = midiHz(m);
      var entries = [];
      for (var k = 1; k <= NUM_HARMONICS; k++) {
        var fk = f0 * k;
        var bin = Math.round(fk / binHz);
        if (bin < 1 || bin >= half - 1) break; // armónico fuera del espectro útil
        var weight = 1 / k;
        // banda ±1 bin alrededor del armónico (resolución del Hann)
        entries.push({ bin: bin, w: weight });
      }
      masks.set(m, entries);
    }
    return masks;
  }

  /** Score de una nota: energía ponderada en sus armónicos / energía total. */
  function scoreNote(mag, entries, totalEnergy) {
    var hit = 0;
    for (var i = 0; i < entries.length; i++) {
      var b = entries[i].bin;
      // pico local: toma el máximo del bin y sus vecinos (afinación ±semitono no requerida)
      var v = Math.max(mag[b - 1], mag[b], mag[b + 1]);
      hit += entries[i].w * v * v;
    }
    if (totalEnergy <= 0) return 0;
    return hit / totalEnergy;
  }

  /**
   * scoreAll(buffer, sampleRate) → Map<midi, score>
   * Calibración: un seno puro en A4 da ≈1.0 (CAL = 1/score_ref, medido en
   * runtime con seno sintético — elimina la dependencia del leakage de Hann).
   * Referencias con calibración aplicada: pura ≈1.0, acorde 2 notas ≈0.5 c/u,
   * ruido < 0.3, silencio 0. Umbral de voz sugerido: 0.45.
   */
  function scoreAll(buffer, sampleRate) {
    if (!FFT) throw new Error('Mask: FFT no disponible');
    if (_calByRate[sampleRate] == null) calibrate(sampleRate);
    var n = buffer.length;
    var mag = FFT.magnitudeSpectrum(buffer);
    var half = mag.length;

    // energía total ponderable (excluye DC)
    var totalEnergy = 0;
    for (var k = 1; k < half; k++) totalEnergy += mag[k] * mag[k];
    if (totalEnergy < 1e-12) {
      var empty = new Map();
      for (var m = MIN_MIDI; m <= MAX_MIDI; m++) empty.set(m, 0);
      return empty;
    }

    var out = new Map();
    for (var m2 = MIN_MIDI; m2 <= MAX_MIDI; m2++) {
      out.set(m2, scoreNote(mag, _masks.get(m2), totalEnergy));
    }

    // Penalización de subarmónicos: si la fundamental de la máscara está fría
    // (aporta <20% del score), probablemente es la nota 2X → castiga.
    for (var m3 = MIN_MIDI; m3 <= MAX_MIDI; m3++) {
      var e = _masks.get(m3);
      if (!e || e.length === 0) continue;
      var b0 = e[0].bin;
      var fund = Math.max(mag[b0 - 1], mag[b0], mag[b0 + 1]);
      var fundSq = fund * fund;
      var share = fundSq / (out.get(m3) * totalEnergy + 1e-12);
      if (share < 0.2) out.set(m3, out.get(m3) * (0.5 + 2.5 * share));
    }

    var cal = _calByRate[sampleRate];
    for (var m4 = MIN_MIDI; m4 <= MAX_MIDI; m4++) {
      out.set(m4, out.get(m4) * cal);
    }
    return out;
  }

  /**
   * Calibración en runtime: seno puro A4 sintético → score crudo S → CAL=1/S.
   * Determinista por sampleRate; una FFT extra solo la primera vez.
   * También inicializa _masks (todas las llamadas usan buffers de 4096).
   */
  function calibrate(sampleRate) {
    var n = 4096;
    _masks = buildMasks(sampleRate, n);
    var f0 = midiHz(69);
    var ref = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      ref[i] = 0.5 * Math.sin(2 * Math.PI * f0 * i / sampleRate);
    }
    var mag = FFT.magnitudeSpectrum(ref);
    var totalEnergy = 0;
    for (var k = 1; k < mag.length; k++) totalEnergy += mag[k] * mag[k];
    var raw = scoreNote(mag, _masks.get(69), totalEnergy);
    _calByRate[sampleRate] = raw > 0 ? 1 / raw : 1;
  }

  function count() { return MAX_MIDI - MIN_MIDI + 1; }
  function minMidi() { return MIN_MIDI; }
  function maxMidi() { return MAX_MIDI; }

  return {
    scoreAll: scoreAll,
    count: count,
    minMidi: minMidi,
    maxMidi: maxMidi
  };
});