// js/fft.js — FFT radix-2 iterativa + espectro de magnitud con ventana Hann.
// Pura, sin DOM. UMD: module.exports (Node) + window.FFT (browser).
'use strict';

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.FFT = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var _hannCache = {};

  function hann(n) {
    if (_hannCache[n]) return _hannCache[n];
    var w = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
    }
    _hannCache[n] = w;
    return w;
  }

  /**
   * FFT in-place radix-2 iterativa (Cooley-Tukey, DIT).
   * re/im: Float64Array de tamaño n (potencia de 2).
   */
  function transform(re, im) {
    var n = re.length;
    if (n !== im.length || (n & (n - 1)) !== 0 || n < 2) {
      throw new Error('FFT: tamaño debe ser potencia de 2 (n=' + n + ')');
    }
    // bit reversal
    for (var i = 1, j = 0; i < n; i++) {
      var bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        var tr = re[i]; re[i] = re[j]; re[j] = tr;
        var ti = im[i]; im[i] = im[j]; im[j] = ti;
      }
    }
    // butterflies
    for (var len = 2; len <= n; len <<= 1) {
      var ang = (-2 * Math.PI) / len;
      var wr0 = Math.cos(ang), wi0 = Math.sin(ang);
      for (var start = 0; start < n; start += len) {
        var wr = 1, wi = 0;
        for (var k = 0; k < len / 2; k++) {
          var ur = re[start + k], ui = im[start + k];
          var vr = re[start + k + len / 2] * wr - im[start + k + len / 2] * wi;
          var vi = re[start + k + len / 2] * wi + im[start + k + len / 2] * wr;
          re[start + k] = ur + vr;
          im[start + k] = ui + vi;
          re[start + k + len / 2] = ur - vr;
          im[start + k + len / 2] = ui - vi;
          var nwr = wr * wr0 - wi * wi0;
          wi = wr * wi0 + wi * wr0;
          wr = nwr;
        }
      }
    }
  }

  /**
   * Espectro de magnitud (mitad inferior, N/2 bins) con ventana Hann.
   * Sin normalización de amplitud: útil para comparar energía relativa.
   */
  function magnitudeSpectrum(samples) {
    var n = samples.length;
    if ((n & (n - 1)) !== 0) throw new Error('magnitudeSpectrum: n debe ser potencia de 2');
    var re = new Float64Array(n);
    var im = new Float64Array(n);
    var w = hann(n);
    for (var i = 0; i < n; i++) re[i] = samples[i] * w[i];
    transform(re, im);
    var half = n >> 1;
    var mag = new Float64Array(half);
    for (var k = 0; k < half; k++) {
      mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
    }
    return mag;
  }

  return {
    transform: transform,
    magnitudeSpectrum: magnitudeSpectrum,
    hann: hann
  };
});