'use strict';

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.EventStream = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MIN_RUN = 2;
  var MERGE_GAP_HOPS = 3;
  var MAX_VOICES = 2;
  var CHORD_MIN_RUN = 3;
  var REATTACK_MIN_GAP_MS = 130;
  var RESONANCE_MS = 400;
  var NEIGHBOR_MERGE_MS = 120;

  function create() {
    return {
      events: [],
      pending: [],
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


    for (var i = es.pending.length - 1; i >= 0; i--) {
      var p = es.pending[i];
      var present = voices && voices.some(function (v) { return v.midi === p.midi; });
      if (present) continue;
      if (tMs - p.tEndMs > MERGE_GAP_HOPS * es._hopMs) {
        if (p.ev && p.ev.chord && !p.chordConfirmed) p.ev.chord = false;
        es.pending.splice(i, 1);
      }
    }

    if (voices && voices.length > 0) {
      var isPair = voices.length > 1;
      var taken = voices.slice(0, MAX_VOICES);
      var historyCount = 0;
      for (var hv = 0; hv < taken.length; hv++) {
        for (var he = es.events.length - 1; he >= 0 && he >= es.events.length - 6; he--) {
          if (es.events[he].midi === taken[hv].midi &&
              (tMs - es.events[he].tEndMs) < RESONANCE_MS) { historyCount++; break; }
        }
      }
      var bothHaveHistory = isPair && historyCount === taken.length;
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
            if (!run.chordConfirmed && run.pairCount >= CHORD_MIN_RUN) {
              run.chordConfirmed = true;
              if (run.ev) run.ev.chord = true;
            }
          } else if (run.pairCount > 0) {
            run.pairCount = 0;
          }
          if (run.ev) {
            run.ev.count = run.count;
            run.ev.tEndMs = tMs;
          } else if (run.count >= MIN_RUN) {
            run.ev = {
              midi: run.midi,
              score: run.score,
              chord: false,
              tStartMs: run.tStartMs,
              tEndMs: tMs,
              count: run.count
            };
            es.events.push(run.ev);
            newEvents.push(run.ev);
          }
        } else {
          var handled = false;
          if (!(bothHaveHistory)) {
            for (var q = es.events.length - 1; q >= 0 && q >= es.events.length - 6; q--) {
              var prevEv = es.events[q];
              if (prevEv.midi === voice.midi &&
                  (tMs - prevEv.tEndMs) < RESONANCE_MS &&
                  voice.score < prevEv.score * 0.95) {
                es.pending.push({
                  midi: voice.midi, score: voice.score,
                  tStartMs: prevEv.tStartMs, tEndMs: tMs,
                  count: prevEv.count + 1, pairCount: isPair ? 1 : 0,
                  chordConfirmed: prevEv.chord, ev: prevEv
                });
                prevEv.count++;
                prevEv.tEndMs = tMs;
                handled = true;
                break;
              }
            }
          }
          if (!handled) {
            for (var q2 = es.events.length - 1; q2 >= 0 && q2 >= es.events.length - 4; q2--) {
              var pe = es.events[q2];
              if (Math.abs(pe.midi - voice.midi) === 1 && (tMs - pe.tEndMs) < 250) {
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