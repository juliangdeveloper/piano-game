// js/score.js — EventStream → partitura cuantizada (VexFlow-ready). Pura, sin DOM.
// UMD: module.exports + window.Score.
//
// Defaults (R20): ♩=80, 4/4, clave de sol. Duraciones al valor más cercano
// entre [redonda, blanca, negra, corchea, semicorchea]. Silencios en los huecos.
// MIDI < 48 (C3) se escribe una octava arriba (8vb) en clave de sol.
'use strict';

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Score = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULT_BPM = 80;
  var DEFAULT_TIME_SIG = '4/4';
  var DEFAULT_CLEF = 'treble';
  var MIDI_8VB_BELOW = 48; // C3: por debajo, 8vb en clave de sol
  var CHORD_WINDOW_MS = 40; // mismo onset → acorde
  var VF_PC = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];

  // Valor en pulsos de negra. semicorchea=0.25 … redonda=4.
  var DURATION_TABLE = [
    { type: 'w', beats: 4, sixteenths: 16 },
    { type: 'h', beats: 2, sixteenths: 8 },
    { type: 'q', beats: 1, sixteenths: 4 },
    { type: '8', beats: 0.5, sixteenths: 2 },
    { type: '16', beats: 0.25, sixteenths: 1 }
  ];

  function defaults(opts) {
    opts = opts || {};
    var bpm = (typeof opts.bpm === 'number' && opts.bpm > 0) ? opts.bpm : DEFAULT_BPM;
    var timeSig = opts.timeSig || DEFAULT_TIME_SIG;
    var clef = opts.clef || DEFAULT_CLEF;
    return { bpm: bpm, timeSig: timeSig, clef: clef };
  }

  function parseTimeSig(str) {
    var parts = String(str || DEFAULT_TIME_SIG).split('/');
    var num = parseInt(parts[0], 10);
    var den = parseInt(parts[1], 10);
    if (!num || num < 1) num = 4;
    if (!den || den < 1) den = 4;
    return { num: num, den: den, str: num + '/' + den };
  }

  function quarterMs(bpm) {
    return 60000 / bpm;
  }

  function measureSixteenths(ts) {
    // 4/4 → 16 semicorcheas; 3/4 → 12, etc. den=4 → num*4; den=8 → num*2.
    return Math.round(ts.num * (16 / ts.den));
  }

  function lookupType(sixteenths) {
    for (var i = 0; i < DURATION_TABLE.length; i++) {
      if (DURATION_TABLE[i].sixteenths === sixteenths) return DURATION_TABLE[i].type;
    }
    return '16';
  }

  /**
   * Cuantiza una duración en ms al valor de nota más cercano
   * entre w/h/q/8/16 al BPM dado.
   */
  function quantizeDuration(durationMs, bpm) {
    var cfg = defaults({ bpm: bpm });
    var qMs = quarterMs(cfg.bpm);
    var ms = (typeof durationMs === 'number' && isFinite(durationMs)) ? durationMs : 0;
    if (ms < 0) ms = 0;
    var beats = ms / qMs;
    var best = DURATION_TABLE[DURATION_TABLE.length - 1];
    var bestDiff = Infinity;
    for (var i = 0; i < DURATION_TABLE.length; i++) {
      var d = Math.abs(beats - DURATION_TABLE[i].beats);
      // empate → el valor más corto (más cercano a lo tocado si es breve)
      if (d < bestDiff || (d === bestDiff && DURATION_TABLE[i].beats < best.beats)) {
        bestDiff = d;
        best = DURATION_TABLE[i];
      }
    }
    return {
      type: best.type,
      beats: best.beats,
      sixteenths: best.sixteenths,
      durationMs: best.beats * qMs
    };
  }

  /**
   * MIDI → clave VexFlow (`c/4`). midi < 48 se escribe +12 (8vb).
   */
  function midiToKey(midi) {
    if (typeof midi !== 'number' || !isFinite(midi)) {
      return { key: 'c/4', ottava: null, midi: midi, accidental: null };
    }
    var m = Math.round(midi);
    var ottava = null;
    var written = m;
    if (m < MIDI_8VB_BELOW) {
      written = m + 12;
      ottava = '8vb';
    }
    var pc = ((written % 12) + 12) % 12;
    var name = VF_PC[pc];
    var oct = Math.floor(written / 12) - 1;
    var accidental = null;
    if (name.length > 1 && name.charAt(1) === '#') accidental = '#';
    return {
      key: name + '/' + oct,
      ottava: ottava,
      midi: m,
      accidental: accidental
    };
  }

  function groupChords(events) {
    var sorted = events.slice().sort(function (a, b) {
      var dt = a.tStartMs - b.tStartMs;
      if (dt !== 0) return dt;
      return a.midi - b.midi;
    });
    var groups = [];
    for (var i = 0; i < sorted.length; i++) {
      var ev = sorted[i];
      var last = groups.length ? groups[groups.length - 1] : null;
      if (last && Math.abs(ev.tStartMs - last.tStartMs) <= CHORD_WINDOW_MS) {
        last.events.push(ev);
        last.tEndMs = Math.max(last.tEndMs, ev.tEndMs);
      } else {
        groups.push({
          tStartMs: ev.tStartMs,
          tEndMs: ev.tEndMs,
          events: [ev]
        });
      }
    }
    return groups;
  }

  function greedySixteenths(n) {
    var parts = [];
    var vals = [16, 8, 4, 2, 1];
    var left = n;
    for (var i = 0; i < vals.length; i++) {
      while (left >= vals[i]) {
        parts.push(vals[i]);
        left -= vals[i];
      }
    }
    return parts;
  }

  function restKeys(clef) {
    return (clef === 'bass') ? ['d/3'] : ['b/4'];
  }

  function makeNoteItem(group, q, clef) {
    var keys = [];
    var accidentals = [];
    var midis = [];
    var ottava = null;
    for (var i = 0; i < group.events.length; i++) {
      var mapped = midiToKey(group.events[i].midi);
      keys.push(mapped.key);
      accidentals.push(mapped.accidental);
      midis.push(mapped.midi);
      if (mapped.ottava) ottava = mapped.ottava;
    }
    return {
      keys: keys,
      duration: q.type,
      rest: false,
      midis: midis,
      ottava: ottava,
      accidentals: accidentals,
      sixteenths: q.sixteenths
    };
  }

  function makeRestItem(q, clef) {
    return {
      keys: restKeys(clef),
      duration: q.type + 'r',
      rest: true,
      midis: [],
      ottava: null,
      accidentals: [null],
      sixteenths: q.sixteenths
    };
  }

  function packMeasures(items, cap) {
    var measures = [{ notes: [] }];
    var used = 0;

    function pushPart(proto, sixteenths) {
      var remain = cap - used;
      if (remain <= 0) {
        measures.push({ notes: [] });
        used = 0;
        remain = cap;
      }
      var take = Math.min(sixteenths, remain);
      var parts = greedySixteenths(take);
      for (var p = 0; p < parts.length; p++) {
        var durType = lookupType(parts[p]);
        measures[measures.length - 1].notes.push({
          keys: proto.keys,
          duration: proto.rest ? durType + 'r' : durType,
          rest: proto.rest,
          midis: proto.midis,
          ottava: proto.ottava,
          accidentals: proto.accidentals,
          sixteenths: parts[p]
        });
        used += parts[p];
      }
      return sixteenths - take;
    }

    for (var i = 0; i < items.length; i++) {
      var left = items[i].sixteenths;
      while (left > 0) {
        left = pushPart(items[i], left);
      }
    }
    return measures;
  }

  /**
   * events: [{midi, score, chord, tStartMs, tEndMs, count}, ...]
   * opts: {bpm, timeSig, clef}
   */
  function eventsToScore(events, opts) {
    var cfg = defaults(opts);
    var ts = parseTimeSig(cfg.timeSig);
    var cap = measureSixteenths(ts);
    var list = Array.isArray(events) ? events.filter(function (e) {
      return e && typeof e.midi === 'number' && typeof e.tStartMs === 'number';
    }) : [];

    var items = [];
    if (list.length > 0) {
      var groups = groupChords(list);
      var qMs = quarterMs(cfg.bpm);
      var sixteenthMs = qMs / 4;
      var restIgnore = sixteenthMs / 2;
      var cursor = groups[0].tStartMs;

      for (var g = 0; g < groups.length; g++) {
        var group = groups[g];
        var gap = group.tStartMs - cursor;
        if (gap >= restIgnore) {
          var restQ = quantizeDuration(gap, cfg.bpm);
          items.push(makeRestItem(restQ, cfg.clef));
        }
        var durMs = (typeof group.tEndMs === 'number' ? group.tEndMs : group.tStartMs) - group.tStartMs;
        if (durMs < 0) durMs = 0;
        var noteQ = quantizeDuration(durMs, cfg.bpm);
        items.push(makeNoteItem(group, noteQ, cfg.clef));
        cursor = group.tStartMs + Math.max(durMs, 0);
      }
    }

    var measures = packMeasures(items, cap);
    return {
      bpm: cfg.bpm,
      timeSig: ts,
      timeSigStr: ts.str,
      clef: cfg.clef,
      measures: measures
    };
  }

  return {
    eventsToScore: eventsToScore,
    quantizeDuration: quantizeDuration,
    midiToKey: midiToKey,
    defaults: defaults,
    DEFAULT_BPM: DEFAULT_BPM,
    DEFAULT_TIME_SIG: DEFAULT_TIME_SIG,
    DEFAULT_CLEF: DEFAULT_CLEF,
    MIDI_8VB_BELOW: MIDI_8VB_BELOW,
    DURATION_TABLE: DURATION_TABLE
  };
});
