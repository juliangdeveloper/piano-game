// test/score.test.js — TDD para js/score.js (cuantización EventStream → partitura)
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const Score = require(path.join(__dirname, '..', 'js', 'score.js'));

const BPM = 80;
const Q = 60000 / BPM; // 750 ms = negra

function ev(midi, t0, t1, extra) {
  return Object.assign({
    midi: midi,
    score: 1,
    chord: false,
    tStartMs: t0,
    tEndMs: t1,
    count: 1
  }, extra || {});
}

function allNotes(score) {
  const out = [];
  for (const m of score.measures) out.push(...m.notes);
  return out;
}

test('Q1: 750ms @80bpm → negra (q)', () => {
  const q = Score.quantizeDuration(750, 80);
  assert.strictEqual(q.type, 'q');
  assert.strictEqual(q.beats, 1);
});

test('Q2: 3000ms @80bpm → redonda (w)', () => {
  assert.strictEqual(Score.quantizeDuration(3000, 80).type, 'w');
});

test('Q3: 1500ms @80bpm → blanca (h)', () => {
  assert.strictEqual(Score.quantizeDuration(1500, 80).type, 'h');
});

test('Q4: 375ms @80bpm → corchea (8)', () => {
  assert.strictEqual(Score.quantizeDuration(375, 80).type, '8');
});

test('Q5: 187.5ms @80bpm → semicorchea (16)', () => {
  assert.strictEqual(Score.quantizeDuration(187.5, 80).type, '16');
});

test('Q6: duración 0 o muy corta → semicorchea (mínimo notado)', () => {
  assert.strictEqual(Score.quantizeDuration(0, 80).type, '16');
  assert.strictEqual(Score.quantizeDuration(50, 80).type, '16');
});

test('Q7: el más cercano gana (700ms→q, 400ms→8)', () => {
  assert.strictEqual(Score.quantizeDuration(700, 80).type, 'q');
  assert.strictEqual(Score.quantizeDuration(400, 80).type, '8');
});

test('Q8: midi 60 → c/4; 69 → a/4; 61 → c#/4 con accidental', () => {
  const c4 = Score.midiToKey(60);
  assert.strictEqual(c4.key, 'c/4');
  assert.strictEqual(c4.ottava, null);
  assert.strictEqual(c4.accidental, null);
  const a4 = Score.midiToKey(69);
  assert.strictEqual(a4.key, 'a/4');
  const cs4 = Score.midiToKey(61);
  assert.strictEqual(cs4.key, 'c#/4');
  assert.strictEqual(cs4.accidental, '#');
});

test('Q9: midi < 48 (C3) se escribe 8vb (C2=36 → c/3); C3=48 sin 8vb', () => {
  const c2 = Score.midiToKey(36);
  assert.strictEqual(c2.key, 'c/3');
  assert.strictEqual(c2.ottava, '8vb');
  const b2 = Score.midiToKey(47);
  assert.strictEqual(b2.key, 'b/3');
  assert.strictEqual(b2.ottava, '8vb');
  const c3 = Score.midiToKey(48);
  assert.strictEqual(c3.key, 'c/3');
  assert.strictEqual(c3.ottava, null);
});

test('Q10: hueco de una negra entre notas → silencio de negra', () => {
  const events = [
    ev(60, 0, 750),
    ev(64, 1500, 2250) // gap 750ms
  ];
  const score = Score.eventsToScore(events, { bpm: 80 });
  const notes = allNotes(score);
  assert.ok(notes.length >= 3, 'nota + silencio + nota, got ' + notes.length);
  assert.strictEqual(notes[0].rest, false);
  assert.deepStrictEqual(notes[0].keys, ['c/4']);
  assert.strictEqual(notes[0].duration, 'q');
  assert.strictEqual(notes[1].rest, true);
  assert.ok(String(notes[1].duration).endsWith('r'), notes[1].duration);
  assert.strictEqual(notes[1].duration, 'qr');
  assert.strictEqual(notes[2].rest, false);
  assert.deepStrictEqual(notes[2].keys, ['e/4']);
});

test('Q11: hueco minúsculo (<½ semicorchea) no inserta silencio', () => {
  const events = [
    ev(60, 0, 750),
    ev(62, 780, 1530) // gap 30ms
  ];
  const score = Score.eventsToScore(events, { bpm: 80 });
  const notes = allNotes(score);
  const rests = notes.filter(n => n.rest);
  assert.strictEqual(rests.length, 0, 'sin silencios: ' + JSON.stringify(notes));
});

test('Q12: dos eventos mismo timestamp → acorde VexFlow (varias keys)', () => {
  const events = [
    ev(60, 0, 750, { chord: true }),
    ev(64, 0, 750, { chord: true })
  ];
  const score = Score.eventsToScore(events, { bpm: 80 });
  const notes = allNotes(score);
  assert.strictEqual(notes.length, 1);
  assert.deepStrictEqual(notes[0].keys, ['c/4', 'e/4']);
  assert.strictEqual(notes[0].rest, false);
  assert.strictEqual(notes[0].duration, 'q');
});

test('Q13: defaults ♩=80, 4/4, treble; compás de 16 semicorcheas', () => {
  const d = Score.defaults();
  assert.strictEqual(d.bpm, 80);
  assert.strictEqual(d.timeSig, '4/4');
  assert.strictEqual(d.clef, 'treble');
  const events = [ev(60, 0, 3000)]; // redonda = 1 compás
  const score = Score.eventsToScore(events);
  assert.strictEqual(score.bpm, 80);
  assert.strictEqual(score.timeSigStr, '4/4');
  assert.strictEqual(score.clef, 'treble');
  assert.strictEqual(score.measures.length, 1);
  assert.strictEqual(score.measures[0].notes[0].duration, 'w');
});

test('Q14: cuatro negras llenan un compás 4/4; la quinta abre otro', () => {
  const events = [
    ev(60, 0, Q),
    ev(62, Q, 2 * Q),
    ev(64, 2 * Q, 3 * Q),
    ev(65, 3 * Q, 4 * Q),
    ev(67, 4 * Q, 5 * Q)
  ];
  const score = Score.eventsToScore(events, { bpm: 80 });
  assert.strictEqual(score.measures.length, 2);
  assert.strictEqual(score.measures[0].notes.length, 4);
  assert.strictEqual(score.measures[1].notes[0].keys[0], 'g/4');
});

test('Q15: lista vacía → un compás vacío (staff inicial)', () => {
  const score = Score.eventsToScore([]);
  assert.strictEqual(score.measures.length, 1);
  assert.deepStrictEqual(score.measures[0].notes, []);
});
