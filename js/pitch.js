'use strict';

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Pitch = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var A4_DEFAULT = 440;
  var WINDOW_SIZE = 4096;
  var MAX_LAG = 760;
  var TAU_MIN = 2;
  var YIN_THRESHOLD = 0.15;
  var NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  function isValidBuffer(buffer) {
    return buffer && typeof buffer.length === 'number' &&
      buffer.length >= 2 * MAX_LAG;
  }

  function detectPitch(buffer, sampleRate, opts) {
    opts = opts || {};
    var clarityThreshold = (typeof opts.clarityThreshold === 'number')
      ? opts.clarityThreshold : 0.90;

    if (!isValidBuffer(buffer) || !sampleRate || sampleRate <= 0) {
      return { freq: null, clarity: 0 };
    }

    var n = Math.min(buffer.length, WINDOW_SIZE);
    var maxLag = Math.min(MAX_LAG, Math.floor(n / 2));
    if (typeof opts.maxLag === 'number' && isFinite(opts.maxLag) && opts.maxLag > TAU_MIN) {
      maxLag = Math.min(maxLag, Math.floor(opts.maxLag));
    }

    var energy = 0;
    for (var e = 0; e < n; e++) energy += buffer[e] * buffer[e];
    if (energy < 1e-9) return { freq: null, clarity: 0 };

    var d = new Float64Array(maxLag + 1);
    for (var tau = TAU_MIN; tau <= maxLag; tau++) {
      var sum = 0;
      for (var i = 0; i < n - tau; i++) {
        var diff = buffer[i] - buffer[i + tau];
        sum += diff * diff;
      }
      d[tau] = sum;
    }

    var dp = new Float64Array(maxLag + 1);
    dp[0] = 1;
    dp[1] = 1;
    var running = 0;
    var bestTau = -1;
    var bestDp = Infinity;

    for (var tau2 = TAU_MIN; tau2 <= maxLag; tau2++) {
      running += d[tau2];
      dp[tau2] = d[tau2] * (tau2 - TAU_MIN + 1) / (running || 1);
      if (dp[tau2] < YIN_THRESHOLD) {
        if (bestTau === -1 || dp[tau2] < bestDp) {
          bestTau = tau2;
          bestDp = dp[tau2];
        }
      } else if (bestTau !== -1) {
        break;
      }
    }

    if (bestTau === -1) {
      for (var tau3 = TAU_MIN; tau3 <= maxLag; tau3++) {
        if (dp[tau3] < bestDp) {
          bestDp = dp[tau3];
          bestTau = tau3;
        }
      }
    }

    if (bestTau < 0) return { freq: null, clarity: 0 };

    var k, sub, j, lo, hi, m, mv;
    for (k = 4; k >= 2; k--) {
      sub = bestTau / k;
      if (sub < TAU_MIN + 1) continue;
      lo = Math.max(TAU_MIN, Math.floor(sub) - 2);
      hi = Math.min(maxLag - 1, Math.ceil(sub) + 2);
      m = -1; mv = Infinity;
      for (j = lo; j <= hi; j++) if (dp[j] < mv) { mv = dp[j]; m = j; }
      if (m > TAU_MIN && dp[m] <= dp[m - 1] && dp[m] <= dp[m + 1] &&
          mv < Math.max(YIN_THRESHOLD * 2, bestDp * 1.6 + 0.06)) {
        bestTau = m; bestDp = mv;
        break;
      }
    }

    var refinedTau = bestTau;
    var s0, s1, s2;
    if (bestTau > TAU_MIN && bestTau < maxLag) {
      s0 = dp[bestTau - 1];
      s1 = dp[bestTau];
      s2 = dp[bestTau + 1];
      var denom = 2 * (2 * s1 - s2 - s0);
      if (Math.abs(denom) > 1e-12) {
        var shift = (s2 - s0) / denom;
        if (Math.abs(shift) < 1) refinedTau = bestTau + shift;
      }
    }

    var clarity = 1 - dp[bestTau];
    if (clarity < 0) clarity = 0;
    if (clarity > 1) clarity = 1;

    return { freq: sampleRate / refinedTau, clarity: clarity };
  }

  function noteFromFreq(freq, a4) {
    if (typeof freq !== 'number' || !isFinite(freq) || freq <= 0) return null;
    if (typeof a4 !== 'number' || !isFinite(a4) || a4 <= 0) a4 = A4_DEFAULT;

    var midiFloat = 69 + 12 * Math.log2(freq / a4);
    var midi = Math.round(midiFloat);
    var cents = Math.round((midiFloat - midi) * 100);
    if (cents > 50) { cents -= 100; midi += 1; }
    if (cents < -50) { cents += 100; midi -= 1; }

    var name = NAMES[((midi % 12) + 12) % 12];
    var octave = Math.floor(midi / 12) - 1;
    return { name: name, octave: octave, cents: cents, midi: midi };
  }

  function hzForNote(name, octave, a4) {
    if (typeof a4 !== 'number' || !isFinite(a4) || a4 <= 0) a4 = A4_DEFAULT;
    var idx = NAMES.indexOf(name);
    if (idx === -1) {
      throw new Error('Nombre de nota inválido: ' + name);
    }
    var midi = idx + (octave + 1) * 12;
    return a4 * Math.pow(2, (midi - 69) / 12);
  }

  function noteFromMidi(midi) {
    if (typeof midi !== 'number' || !isFinite(midi) || midi % 1 !== 0) return null;
    if (midi < 0 || midi > 127) return null;
    return {
      name: NAMES[midi % 12],
      octave: Math.floor(midi / 12) - 1,
      cents: 0,
      midi: midi
    };
  }

  function clarifyThresholdForMidi(midi, opts) {
    var strict = 0.90, relaxed = 0.78;
    if (opts && typeof opts.strict === 'number') strict = opts.strict;
    if (opts && typeof opts.relaxed === 'number') relaxed = opts.relaxed;
    return midi >= 72 ? relaxed : strict;
  }

  return {
    detectPitch: detectPitch,
    noteFromFreq: noteFromFreq,
    hzForNote: hzForNote,
    noteFromMidi: noteFromMidi,
    clarifyThresholdForMidi: clarifyThresholdForMidi,
    WINDOW_SIZE: WINDOW_SIZE,
    MAX_LAG: MAX_LAG,
    TAU_MIN: TAU_MIN,
    YIN_THRESHOLD: YIN_THRESHOLD
  };
});
