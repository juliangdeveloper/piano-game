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
    : (typeof self !== 'undefined' ? self.FFT : null);

  var MIN_MIDI = 36;
  var MAX_MIDI = 96;
  var NUM_HARMONICS = 8;
  var A4 = 440;

  var _masks = null;
  var _calByRate = {};

  function midiHz(m, a4) {
    return (a4 || A4) * Math.pow(2, (m - 69) / 12);
  }

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
        if (bin < 1 || bin >= half - 1) break;
        var weight = 1 / k;
        entries.push({ bin: bin, w: weight });
      }
      masks.set(m, entries);
    }
    return masks;
  }

  function scoreNote(mag, entries, totalEnergy) {
    var hit = 0;
    for (var i = 0; i < entries.length; i++) {
      var b = entries[i].bin;
      var v = Math.max(mag[b - 1], mag[b], mag[b + 1]);
      hit += entries[i].w * v * v;
    }
    if (totalEnergy <= 0) return 0;
    return hit / totalEnergy;
  }

  function scoreAll(buffer, sampleRate) {
    if (!FFT) throw new Error('Mask: FFT no disponible');
    if (_calByRate[sampleRate] == null) calibrate(sampleRate);
    var n = buffer.length;
    var mag = FFT.magnitudeSpectrum(buffer);
    var half = mag.length;

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