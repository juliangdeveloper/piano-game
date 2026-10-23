// js/progress.js — progreso de piano-transcribe sobre meta.v1.
// UMD: module.exports (Node) + window.Progress (navegador).
'use strict';

(function (root, factory) {
  var Meta = (typeof module === 'object' && module.exports) ? require('./meta.js') : root.Meta;
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(Meta);
  } else {
    root.Progress = factory(Meta);
  }
})(typeof self !== 'undefined' ? self : this, function (Meta) {
  'use strict';

  var SLUG = 'piano-transcribe';
  var WRITE_MS = 1000;

  // Claves declaradas (máximo 20), en el orden de guardado.
  // monotonic: totales, conteos y mejores marcas; no bajan.
  var STATS = [
    { key: 'sessions', monotonic: true }, // sesiones de escucha abiertas
    { key: 'notes_captured_total', monotonic: true }, // notas capturadas en total
    { key: 'longest_session_notes', monotonic: true }, // máximo de notas en una sesión
    { key: 'chords_captured', monotonic: true } // acordes: cada entrada a dos o más notas
  ];

  // Ids estables. No se renombran ni se reutilizan. La condición es el umbral.
  var ACHIEVEMENTS = [
    // first_note: notes_captured_total >= 1
    { id: 'first_note', test: function (s) { return s.notes_captured_total >= 1; } },
    // ten_notes: notes_captured_total >= 10
    { id: 'ten_notes', test: function (s) { return s.notes_captured_total >= 10; } },
    // hundred_notes: notes_captured_total >= 100
    { id: 'hundred_notes', test: function (s) { return s.notes_captured_total >= 100; } },
    // five_hundred_notes: notes_captured_total >= 500
    { id: 'five_hundred_notes', test: function (s) { return s.notes_captured_total >= 500; } },
    // thousand_notes: notes_captured_total >= 1000
    { id: 'thousand_notes', test: function (s) { return s.notes_captured_total >= 1000; } },
    // first_session: sessions >= 1
    { id: 'first_session', test: function (s) { return s.sessions >= 1; } },
    // ten_sessions: sessions >= 10
    { id: 'ten_sessions', test: function (s) { return s.sessions >= 10; } },
    // fifty_sessions: sessions >= 50
    { id: 'fifty_sessions', test: function (s) { return s.sessions >= 50; } },
    // first_chord: chords_captured >= 1
    { id: 'first_chord', test: function (s) { return s.chords_captured >= 1; } },
    // ten_chords: chords_captured >= 10
    { id: 'ten_chords', test: function (s) { return s.chords_captured >= 10; } },
    // long_phrase: longest_session_notes >= 16
    { id: 'long_phrase', test: function (s) { return s.longest_session_notes >= 16; } },
    // recital: longest_session_notes >= 64
    { id: 'recital', test: function (s) { return s.longest_session_notes >= 64; } }
  ];

  function emptyStats() {
    var stats = {};
    var i;
    for (i = 0; i < STATS.length; i++) stats[STATS[i].key] = 0;
    return stats;
  }

  function num(value) {
    return typeof value === 'number' && isFinite(value) && value >= 0 ? value : 0;
  }

  function logrosFor(stats) {
    var ids = [];
    var i;
    for (i = 0; i < ACHIEVEMENTS.length; i++) {
      if (ACHIEVEMENTS[i].test(stats)) ids.push(ACHIEVEMENTS[i].id);
    }
    return ids;
  }

  // No hay contadores previos: la página solo guardaba la fuente y la versión del motor.
  function deriveLegacy() {
    var stats = emptyStats();
    return { stats: stats, logros: logrosFor(stats) };
  }

  function locationSearch(win) {
    try {
      if (!win && typeof window !== 'undefined') win = window;
      if (win && win.location && typeof win.location.search === 'string') return win.location.search;
    } catch (e) {}
    return '';
  }

  function searchIsDemo(search) {
    return /(?:^|[?&])demo=(?:1|true)(?:&|$)/.test(search || '')
      || /(?:^|[?&])preview=(?:1|true)(?:&|$)/.test(search || '');
  }

  function createTracker(opts) {
    opts = opts || {};
    var version = opts.version || '';
    var demo = opts.demo === true || searchIsDemo(locationSearch(opts.window));
    var envBase = {
      localStorage: opts.localStorage,
      now: opts.now,
      window: opts.window,
      declared: STATS,
      demo: demo
    };
    var clock = typeof opts.clock === 'function' ? opts.clock : function () { return Date.now(); };
    var setTimer = typeof opts.setTimer === 'function' ? opts.setTimer : function (fn, ms) {
      return setTimeout(fn, ms);
    };
    var clearTimer = typeof opts.clearTimer === 'function' ? opts.clearTimer : function (id) {
      clearTimeout(id);
    };
    var stats = emptyStats();
    var sessionOpen = false;
    var sessionNotes = 0;
    var chordLive = false;
    var timer = 0;
    var lastWrite = 0;
    var dirty = false;

    function storageOf() {
      if (envBase.localStorage) return envBase.localStorage;
      if (typeof localStorage !== 'undefined') return localStorage;
      return null;
    }

    function readRaw() {
      try {
        var storage = storageOf();
        if (!storage) return null;
        return storage.getItem(Meta.keyFor(SLUG));
      } catch (e) {
        return null;
      }
    }

    function snapshot() {
      var out = {};
      var i;
      for (i = 0; i < STATS.length; i++) out[STATS[i].key] = stats[STATS[i].key];
      return out;
    }

    function callEnv() {
      var ms = clock();
      return {
        localStorage: envBase.localStorage,
        window: envBase.window,
        declared: STATS,
        demo: demo,
        now: envBase.now != null ? envBase.now : new Date(ms),
        nowMs: ms
      };
    }

    function commit() {
      if (demo || !dirty || !Meta || typeof Meta.metaUpdate !== 'function') return null;
      var before = readRaw();
      var record = Meta.metaUpdate(SLUG, version, {
        stats: snapshot(),
        logros: logrosFor(stats)
      }, callEnv());
      var after = readRaw();
      if (before !== after) {
        lastWrite = clock();
        dirty = false;
        return record;
      }
      if (record && !timer) {
        var wait = WRITE_MS - (clock() - lastWrite);
        if (wait < 1) wait = WRITE_MS;
        timer = setTimer(function () {
          timer = 0;
          commit();
        }, wait);
      }
      return record;
    }

    function schedule() {
      if (demo) return;
      dirty = true;
      var elapsed = clock() - lastWrite;
      if (elapsed >= WRITE_MS) {
        if (timer) {
          clearTimer(timer);
          timer = 0;
        }
        commit();
        return;
      }
      if (timer) return;
      timer = setTimer(function () {
        timer = 0;
        commit();
      }, WRITE_MS - elapsed);
    }

    function applyRecord(record) {
      if (!record || !record.stats) return;
      var i;
      for (i = 0; i < STATS.length; i++) {
        stats[STATS[i].key] = num(record.stats[STATS[i].key]);
      }
    }

    return {
      load: function () {
        if (demo) return null;
        var before = readRaw();
        var record = null;
        if (Meta && typeof Meta.metaBackfill === 'function') {
          record = Meta.metaBackfill(SLUG, version, deriveLegacy, callEnv());
        }
        applyRecord(record);
        if (before !== readRaw()) lastWrite = clock();
        else lastWrite = clock() - WRITE_MS;
        dirty = false;
        return record;
      },
      beginSession: function () {
        if (demo || sessionOpen) return;
        sessionOpen = true;
        sessionNotes = 0;
        chordLive = false;
        stats.sessions += 1;
        schedule();
      },
      endSession: function () {
        if (demo || !sessionOpen) return;
        sessionOpen = false;
        chordLive = false;
        if (sessionNotes > stats.longest_session_notes) {
          stats.longest_session_notes = sessionNotes;
        }
        schedule();
      },
      captureNote: function (heldCount) {
        if (demo) return;
        var held = typeof heldCount === 'number' && isFinite(heldCount) ? heldCount : 1;
        stats.notes_captured_total += 1;
        if (sessionOpen) {
          sessionNotes += 1;
          if (sessionNotes > stats.longest_session_notes) {
            stats.longest_session_notes = sessionNotes;
          }
        }
        if (held >= 2) {
          if (!chordLive) {
            chordLive = true;
            stats.chords_captured += 1;
          }
        } else {
          chordLive = false;
        }
        schedule();
      },
      stats: function () {
        return snapshot();
      },
      flush: function () {
        if (demo || !dirty) return null;
        if (clock() - lastWrite < WRITE_MS) return null;
        if (timer) {
          clearTimer(timer);
          timer = 0;
        }
        return commit();
      }
    };
  }

  return {
    SLUG: SLUG,
    STATS: STATS,
    ACHIEVEMENTS: ACHIEVEMENTS,
    emptyStats: emptyStats,
    logrosFor: logrosFor,
    deriveLegacy: deriveLegacy,
    createTracker: createTracker
  };
});
