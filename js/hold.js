// js/hold.js — Lógica de estabilidad y hold de notas (R4 + R10). Pura, sin DOM, sin audio.
// UMD: module.exports (Node) + window.Hold (browser).
'use strict';

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Hold = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STABLE_FRAMES = 3;   // R4: frames consecutivos para volver una nota estable
  var HOLD_FRAMES = 15;    // R10: la nota estable sobrevive gaps de hasta 15 frames

  /**
   * Máquina de estados de nota estable con hold (R4+R10).
   *
   * update(note, state) donde note = {name, octave, cents, midi} o null.
   * state se muta en el lugar; crear con Hold.createState() una vez.
   *
   * Retorna {display, changed}:
   *   display: nota a mostrar ({name,...}) o null → '—'
   *   changed: true si la nota estable CAMBIÓ respecto a la estable anterior
   *            (solo el momento de consolidación; el caller usa esto para el log, R7)
   */
  function createState() {
    return {
      stable: null,       // nota estable actual (o null)
      candidateKey: null, // clave de la nota candidata actual
      candidateCount: 0,  // frames consecutivos de la candidata
      holdCount: 0        // frames de gap desde que se perdió la señal
    };
  }

  function noteKey(note) {
    return note.name + note.octave;
  }

  function update(note, state) {
    if (note) {
      state.holdCount = 0;
      var key = noteKey(note);
      if (key === state.candidateKey) {
        state.candidateCount++;
      } else {
        state.candidateKey = key;
        state.candidateCount = 1;
      }
      if (state.candidateCount >= STABLE_FRAMES) {
        var prev = state.stable;
        // R7/R10: "cambió" se evalúa contra la nota estable previa REAL.
        // El hold mantiene `stable` viva durante gaps cortos, así que
        // la misma nota tras un gap ≤ HOLD_FRAMES NO se re-loguea.
        var changed = !prev || prev.name !== note.name || prev.octave !== note.octave;
        state.stable = note;
        return { display: note, changed: changed };
      }
      // candidata aún no consolidada: seguir mostrando la estable (si hay, vive por hold)
      return { display: state.stable, changed: false };
    }

    // ---- frame sin nota (gap) ----
    state.candidateKey = null;
    state.candidateCount = 0;
    if (state.stable && state.holdCount < HOLD_FRAMES) {
      state.holdCount++;
      // R10: mantener el display durante el gap (no re-loguea: changed=false)
      return { display: state.stable, changed: false };
    }
    // gap > HOLD_FRAMES (o no había estable): soltar → '—'
    state.stable = null;
    state.candidateKey = null;
    state.candidateCount = 0;
    state.holdCount = 0;
    return { display: null, changed: false };
  }

  /**
   * Modo MIDI (R11): eventos discretos — sin contador R4 ni hold.
   * note-on → display inmediato; note-off (null) → display null inmediato.
   * Cada pulsación es un evento: misma nota tras note-off SÍ re-loguea.
   */
  function midiUpdate(state, note) {
    if (note) {
      var prev = state.stable;
      var changed = !prev || prev.name !== note.name || prev.octave !== note.octave;
      state.stable = note;
      return { display: note, changed: changed };
    }
    state.stable = null;
    state.candidateKey = null;
    state.candidateCount = 0;
    state.holdCount = 0;
    return { display: null, changed: false };
  }

  return {
    update: update,
    midiUpdate: midiUpdate,
    createState: createState,
    STABLE_FRAMES: STABLE_FRAMES,
    HOLD_FRAMES: HOLD_FRAMES
  };
});