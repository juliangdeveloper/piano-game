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
    return {
      sessions: 0,
      notes_captured_total: 0,
      longest_session_notes: 0,
      chords_captured: 0
    };
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

  function createTracker(opts) {
    opts = opts || {};
    var version = opts.version || '';
    var env = {
      localStorage: opts.localStorage,
      now: opts.now,
      window: opts.window
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

    function snapshot() {
      return {
        sessions: stats.sessions,
        notes_captured_total: stats.notes_captured_total,
        longest_session_notes: stats.longest_session_notes,
        chords_captured: stats.chords_captured
      };
    }

    function write() {
      if (!Meta || typeof Meta.metaUpdate !== 'function') return null;
      lastWrite = clock();
      dirty = false;
      var callEnv = {
        localStorage: env.localStorage,
        window: env.window,
        now: env.now != null ? env.now : new Date(lastWrite)
      };
      return Meta.metaUpdate(SLUG, version, {
        stats: snapshot(),
        logros: logrosFor(stats)
      }, callEnv);
    }

    function schedule() {
      dirty = true;
      var elapsed = clock() - lastWrite;
      if (elapsed >= WRITE_MS) {
        if (timer) {
          clearTimer(timer);
          timer = 0;
        }
        write();
        return;
      }
      if (timer) return;
      timer = setTimer(function () {
        timer = 0;
        write();
      }, WRITE_MS - elapsed);
    }

    function applyRecord(record) {
      if (!record || !record.stats) return;
      stats.sessions = num(record.stats.sessions);
      stats.notes_captured_total = num(record.stats.notes_captured_total);
      stats.longest_session_notes = num(record.stats.longest_session_notes);
      stats.chords_captured = num(record.stats.chords_captured);
    }

    return {
      load: function () {
        var record = null;
        if (Meta && typeof Meta.metaBackfill === 'function') {
          record = Meta.metaBackfill(SLUG, version, deriveLegacy, env);
        }
        applyRecord(record);
        lastWrite = clock();
        dirty = false;
        return record;
      },
      beginSession: function () {
        if (sessionOpen) return;
        sessionOpen = true;
        sessionNotes = 0;
        chordLive = false;
        stats.sessions += 1;
        schedule();
      },
      endSession: function () {
        if (!sessionOpen) return;
        sessionOpen = false;
        chordLive = false;
        if (sessionNotes > stats.longest_session_notes) {
          stats.longest_session_notes = sessionNotes;
        }
        schedule();
      },
      captureNote: function (heldCount) {
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
        if (!dirty) return null;
        if (timer) {
          clearTimer(timer);
          timer = 0;
        }
        return write();
      }
    };
  }

  return {
    SLUG: SLUG,
    ACHIEVEMENTS: ACHIEVEMENTS,
    emptyStats: emptyStats,
    logrosFor: logrosFor,
    deriveLegacy: deriveLegacy,
    createTracker: createTracker
  };
});
