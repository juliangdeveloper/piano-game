// js/eventstream.js — Máquina de eventos R16/R17: hops con score → eventos de nota.
// Semántica: run de MIN_RUN hops = evento emitido inmediatamente (lista en vivo);
// el evento se EXTENDERÁ in-place (count/tEnd) mientras la nota siga; gap ≤3 hops
// de la misma nota = misma pulsación (merge); gap mayor = re-tocada (evento nuevo).
// Acorde: hasta MAX_VOICES notas por hop, cada una su evento (teclas individuales).
// Pura, sin DOM. UMD: module.exports + window.EventStream.
'use strict';

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.EventStream = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MIN_RUN = 2;        // hops consecutivos para consolidar evento (anti-espurio)
  var MERGE_GAP_HOPS = 3; // gap ≤3 hops misma nota → mismo evento (decaimiento)
  var MAX_VOICES = 2;     // máx notas simultáneas por hop (acordes simples)

  function create() {
    return {
      events: [],   // {midi, score, chord, tStartMs, tEndMs, count} — lista final en orden
      pending: [],  // runs en construcción/vida: {midi, score, chord, tStartMs, tEndMs, count, ev}
      _hopMs: 21.3
    };
  }

  function setHopMs(es, hopMs) { es._hopMs = hopMs; }

  function reset(es) {
    var fresh = create();
    es.events = fresh.events;
    es.pending = fresh.pending;
    es._hopMs = fresh._hopMs;
  }

  /**
   * pushBatch(es, hops): hops = [{voices, tMs}] — ordena por t (backfill de 200ms
   * puede llegar desordenado) y procesa en orden. Retorna {newEvents:[...]}.
   * voices: [{midi, score, chord}] | null
   */
  function pushBatch(es, hops) {
    var sorted = hops.slice().sort(function (a, b) { return a.tMs - b.tMs; });
    var allNew = [];
    for (var i = 0; i < sorted.length; i++) {
      var r = push(es, sorted[i].voices, sorted[i].tMs);
      allNew = allNew.concat(r.newEvents);
    }
    return { newEvents: allNew };
  }

  function push(es, voices, tMs) {
    if (voices && !Array.isArray(voices)) voices = [voices];
    var newEvents = [];

    // --- fase 1: recorrer pendientes; extender los que están, matar los vencidos ---
    for (var i = es.pending.length - 1; i >= 0; i--) {
      var p = es.pending[i];
      var present = voices && voices.some(function (v) { return v.midi === p.midi; });
      if (present) continue; // se extiende en fase 2
      // vencido: gap desde su último hop supera MERGE_GAP_HOPS
      if (tMs - p.tEndMs > MERGE_GAP_HOPS * es._hopMs) {
        es.pending.splice(i, 1); // si p.ev existe, el evento ya está en la lista
      }
    }

    // --- fase 2: voices del hop ---
    if (voices && voices.length > 0) {
      var taken = voices.slice(0, MAX_VOICES);
      for (var v = 0; v < taken.length; v++) {
        var voice = taken[v];
        var run = null;
        for (var r = 0; r < es.pending.length; r++) {
          if (es.pending[r].midi === voice.midi) { run = es.pending[r]; break; }
        }
        if (run) {
          run.count++;
          run.tEndMs = tMs;
          run.score = Math.max(run.score, voice.score);
          if (run.ev) {
            // evento ya emitido: extender in-place (merge R16)
            run.ev.count = run.count;
            run.ev.tEndMs = tMs;
          } else if (run.count >= MIN_RUN) {
            // consolidar: emitir evento (lista en vivo, ~MIN_RUN*hopMs tras el onset)
            run.ev = {
              midi: run.midi,
              score: run.score,
              chord: run.chord,
              tStartMs: run.tStartMs,
              tEndMs: tMs,
              count: run.count
            };
            es.events.push(run.ev);
            newEvents.push(run.ev);
          }
        } else {
          es.pending.push({
            midi: voice.midi,
            score: voice.score,
            chord: voices.length > 1,
            tStartMs: tMs,
            tEndMs: tMs,
            count: 1,
            ev: null
          });
        }
      }
    }

    return { newEvents: newEvents };
  }

  return {
    create: create,
    reset: reset,
    push: push,
    pushBatch: pushBatch,
    setHopMs: setHopMs,
    MIN_RUN: MIN_RUN,
    MERGE_GAP_HOPS: MERGE_GAP_HOPS,
    MAX_VOICES: MAX_VOICES
  };
});