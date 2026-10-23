'use strict';

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Hold = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STABLE_FRAMES = 3;
  var HOLD_FRAMES = 15;

  function createState() {
    return {
      stable: null,
      candidateKey: null,
      candidateCount: 0,
      holdCount: 0
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
        var changed = !prev || prev.name !== note.name || prev.octave !== note.octave;
        state.stable = note;
        return { display: note, changed: changed };
      }
      return { display: state.stable, changed: false };
    }

    state.candidateKey = null;
    state.candidateCount = 0;
    if (state.stable && state.holdCount < HOLD_FRAMES) {
      state.holdCount++;
      return { display: state.stable, changed: false };
    }
    state.stable = null;
    state.candidateKey = null;
    state.candidateCount = 0;
    state.holdCount = 0;
    return { display: null, changed: false };
  }

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