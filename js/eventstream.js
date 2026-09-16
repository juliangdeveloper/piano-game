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
  var CHORD_MIN_RUN = 3;  // 2 voces deben coexistir ≥3 hops (~64ms) para confirmar acorde
  var REATTACK_MIN_GAP_MS = 130; // re-tocada antes de esto = ES el mismo evento (extiende)
  var NEIGHBOR_MERGE_MS = 120;   // detecciones de semitonos vecinos dentro de esta ventana = UNA nota (fuga de máscara al onset)

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

    // --- fase 0: acompanamiento por voz para el filtro de acorde (R15) ---
    // voices: [{midi, score, chordCand}] — chordCand = 2 voces en este hop

    // --- fase 1: recorrer pendientes; extender los que están, matar los vencidos ---
    for (var i = es.pending.length - 1; i >= 0; i--) {
      var p = es.pending[i];
      var present = voices && voices.some(function (v) { return v.midi === p.midi; });
      if (present) continue; // se extiende en fase 2
      // vencido: gap desde su último hop supera MERGE_GAP_HOPS
      if (tMs - p.tEndMs > MERGE_GAP_HOPS * es._hopMs) {
        // si era acorde no confirmado, emitirlo como nota sola
        if (p.ev && p.ev.chord && !p.chordConfirmed) p.ev.chord = false;
        es.pending.splice(i, 1);
      }
    }

    // --- fase 2: voices del hop ---
    if (voices && voices.length > 0) {
      var isPair = voices.length > 1;
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
          if (isPair) {
            run.pairCount++;
            // confirmar acorde: 2 voces coexisten ≥CHORD_MIN_RUN hops
            if (!run.chordConfirmed && run.pairCount >= CHORD_MIN_RUN) {
              run.chordConfirmed = true;
              if (run.ev) run.ev.chord = true;
            }
          } else if (run.pairCount > 0) {
            run.pairCount = 0; // se rompió la coexistencia: reinicia el conteo
          }
          if (run.ev) {
            run.ev.count = run.count;
            run.ev.tEndMs = tMs;
          } else if (run.count >= MIN_RUN) {
            // consolidar: evento inmediato; chord provisorio (confirmable después)
            // NOTA: NO resetear pairCount aquí — ya viene contando desde el onset
            // (el reset v1.4.3 lo pisaba: pairCount jamás llegaba a CHORD_MIN_RUN)
            run.ev = {
              midi: run.midi,
              score: run.score,
              chord: false, // aún no confirmado: la UI no pinta ♪♪ hasta confirmar
              tStartMs: run.tStartMs,
              tEndMs: tMs,
              count: run.count
            };
            es.events.push(run.ev);
            newEvents.push(run.ev);
          }
        } else {
          // --- anti-duplicados al onset (por voz; las demás voces del hop se procesan normal) ---
          var handled = false;
          // 1. Resonancia: misma nota reaparece <REATTACK tras el tEnd del evento,
          //    y el hop trae UNA sola voz (un acorde en el hop = onset nuevo real).
          if (!isPair) {
            for (var q = es.events.length - 1; q >= 0 && q >= es.events.length - 6; q--) {
              var prevEv = es.events[q];
              if (prevEv.midi === voice.midi &&
                  (tMs - prevEv.tEndMs) < REATTACK_MIN_GAP_MS) {
                es.pending.push({
                  midi: voice.midi, score: voice.score,
                  tStartMs: prevEv.tStartMs, tEndMs: tMs,
                  count: prevEv.count + 1, pairCount: 0,
                  chordConfirmed: prevEv.chord, ev: prevEv
                });
                prevEv.count++;
                prevEv.tEndMs = tMs;
                handled = true;
                break;
              }
            }
          }
          // 2. Fuga de vecino: semitono adyacente <NEIGHBOR_MERGE_MS tras una nota
          //    fuerte = onset fugó a la máscara vecina → no genera evento.
          if (!handled) {
            for (var q2 = es.events.length - 1; q2 >= 0 && q2 >= es.events.length - 4; q2--) {
              var pe = es.events[q2];
              if (Math.abs(pe.midi - voice.midi) === 1 && (tMs - pe.tStartMs) < NEIGHBOR_MERGE_MS) {
                handled = true;
                break;
              }
            }
          }
          if (handled) continue;
          es.pending.push({
            midi: voice.midi,
            score: voice.score,
            tStartMs: tMs,
            tEndMs: tMs,
            count: 1,
            pairCount: isPair ? 1 : 0,
            chordConfirmed: false,
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