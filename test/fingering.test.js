// test/fingering.test.js — digitación 1–5, sin cambiar createCapture.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

async function engine() {
  return import(path.join('file://', __dirname, '..', 'engine', 'v1', 'capture.js'));
}

function fingers(mod, notes, hand) {
  return mod.suggestFingering(notes, hand ? { hand: hand } : undefined).map(function (row) {
    return row.notes.map(function (n) { return n.finger; });
  });
}

function play(mod, midis, opts) {
  const session = mod.createCapture({ profile: 'score', score: { bpm: 80, timeSig: '4/4' } });
  midis.forEach(function (midi, i) {
    const extra = opts && opts.fingerAt === i ? { finger: opts.finger } : undefined;
    session.press(midi, 'midi', i * 750, extra);
    session.release(midi, 'midi', (i + 1) * 750 - 30);
  });
  const notes = [];
  session.score().measures.forEach(function (measure) {
    measure.notes.forEach(function (n) { if (!n.rest) notes.push(n); });
  });
  return notes;
}

test('posición de do en la derecha y su espejo en la izquierda', async () => {
  const mod = await engine();
  assert.strictEqual(typeof mod.suggestFingering, 'function');
  assert.deepStrictEqual(fingers(mod, [60, 62, 64, 65, 67]), [[1], [2], [3], [4], [5]]);
  assert.deepStrictEqual(fingers(mod, ['C4', 'D4', 'E4', 'F4', 'G4'], 'R'), [[1], [2], [3], [4], [5]]);
  assert.deepStrictEqual(fingers(mod, [48, 50, 52, 53, 55], 'L'), [[5], [4], [3], [2], [1]]);
  const score = play(mod, [60, 62, 64, 65, 67]);
  assert.deepStrictEqual(score.map(function (n) { return n.finger; }), [1, 2, 3, 4, 5]);
  assert.strictEqual(score[0].fingers[0], 1);
  assert.strictEqual(score[0].voices[0].finger, 1);
  assert.strictEqual(score[0].givenFingers, undefined);
});

test('la escala de do cruza el pulgar', async () => {
  const mod = await engine();
  const rh = [60, 62, 64, 65, 67, 69, 71, 72];
  assert.deepStrictEqual(fingers(mod, rh, 'R'), [[1], [2], [3], [1], [2], [3], [4], [5]]);
  assert.deepStrictEqual(
    fingers(mod, [48, 50, 52, 53, 55, 57, 59, 60], 'L'),
    [[5], [4], [3], [2], [1], [3], [2], [1]]
  );
  const score = play(mod, rh);
  assert.deepStrictEqual(score.map(function (n) { return n.finger; }), [1, 2, 3, 1, 2, 3, 4, 5]);
  assert.ok(score.some(function (n, i) { return i > 0 && n.finger === 1 && score[i - 1].finger > 1; }));
});

test('dos notas a la vez llevan dedos distintos y en orden', async () => {
  const mod = await engine();
  const rh = mod.suggestFingering([[60, 64], [60, 67]], { hand: 'R' });
  assert.deepStrictEqual(rh[0].notes.map(function (n) { return n.finger; }), [1, 3]);
  assert.deepStrictEqual(rh[1].notes.map(function (n) { return n.finger; }), [1, 5]);
  assert.ok(rh[0].notes[0].finger < rh[0].notes[1].finger);
  assert.notStrictEqual(rh[0].notes[0].finger, rh[0].notes[1].finger);
  const lh = mod.suggestFingering([{ midis: [48, 52] }], { hand: 'L' });
  assert.ok(lh[0].notes[1].finger < lh[0].notes[0].finger);
  assert.notStrictEqual(lh[0].notes[0].finger, lh[0].notes[1].finger);
  const held = fingers(mod, [[60, 64], [60, 65], [60, 67]], 'R');
  assert.deepStrictEqual(held, [[1, 3], [1, 4], [1, 5]]);

  const session = mod.createCapture({ profile: 'score', score: { bpm: 80, timeSig: '4/4' } });
  session.press(60, 'midi', 0);
  session.press(64, 'midi', 10);
  session.release(60, 'midi', 750);
  session.release(64, 'midi', 750);
  const chord = session.score().measures[0].notes.filter(function (n) { return !n.rest; })[0];
  assert.deepStrictEqual(chord.pitches, ['C4', 'E4']);
  assert.deepStrictEqual(chord.fingers, [1, 3]);
  assert.deepStrictEqual(chord.voices.map(function (v) { return v.finger; }), [1, 3]);
  assert.strictEqual(chord.finger, 1);
  assert.strictEqual(chord.note, 'C');
  assert.strictEqual(chord.octave, 4);
});

test('un dedo explícito se mantiene y el perfil combat sigue igual', async () => {
  const mod = await engine();
  const locked = mod.suggestFingering([
    { midi: 60 },
    { pitch: 'D4' },
    { note: 'E', octave: 4, finger: 1 },
    { midi: 65 }
  ], { hand: 'R' });
  assert.strictEqual(locked[2].finger, 1);
  assert.strictEqual(locked[2].notes[0].finger, 1);

  const notes = play(mod, [60, 62, 64, 65, 67], { fingerAt: 0, finger: 4 });
  assert.strictEqual(notes[0].finger, 4);
  assert.strictEqual(notes[0].fingers[0], 4);
  notes.forEach(function (n) {
    assert.ok(n.finger >= 1 && n.finger <= 5);
  });

  const combat = mod.createCapture({ profile: 'combat' });
  const on = combat.press('C4', 'key', 0);
  assert.strictEqual(on.events[0].pitch, 'C4');
  assert.strictEqual(on.events[0].note, 'C');
  assert.strictEqual(on.events[0].octave, 4);
  assert.strictEqual(combat.score().measures[0].notes[0].pitch, 'C4');
});
