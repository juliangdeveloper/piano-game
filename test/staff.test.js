'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const Staff = require('../js/staff.js');

function fakeVexFlow() {
  const log = { staves: [], connectors: [], notes: [], annotations: [] };
  class Stave {
    constructor(x, y, w) { this.x = x; this.y = y; this.w = w; this.mods = []; this.start = x + 40; log.staves.push(this); }
    addClef(c) { this.clef = c; this.mods.push('clef:' + c); this.start += 30; return this; }
    addTimeSignature(t) { this.timeSig = t; this.mods.push('time:' + t); this.start += 20; return this; }
    getNoteStartX() { return this.start; }
    setNoteStartX(x) { this.start = x; return this; }
    setContext() { return this; }
    draw() { this.drawn = true; return this; }
  }
  class StaveConnector {
    constructor(top, bottom) { this.top = top; this.bottom = bottom; log.connectors.push(this); }
    setType(t) { this.type = t; return this; }
    setContext() { return this; }
    draw() { this.drawn = true; return this; }
  }
  class StaveNote {
    constructor(o) { this.clef = o.clef; this.keys = o.keys; this.duration = o.duration; this.mods = []; log.notes.push(this); }
    addModifier(m, i) { this.mods.push({ m, i }); return this; }
  }
  class Accidental { constructor(t) { this.type = t; } }
  class Annotation {
    constructor(t) { this.text = t; log.annotations.push(this); }
    setFont() { return this; }
    setVerticalJustification(j) { this.just = j; return this; }
  }
  Annotation.VerticalJustify = { TOP: 1, BOTTOM: 3 };
  class Voice {
    constructor() { this.tickables = []; }
    setMode() { return this; }
    addTickables(t) { this.tickables = this.tickables.concat(t); return this; }
    draw(ctx, stave) { this.stave = stave; }
  }
  Voice.Mode = { SOFT: 2 };
  class Formatter { joinVoices() { return this; } formatToStave() { return this; } }
  class Renderer { constructor() {} resize() {} getContext() { return {}; } }
  Renderer.Backends = { SVG: 2 };
  return { log, VF: { Stave, StaveConnector, StaveNote, Accidental, Annotation, Voice, Formatter, Renderer } };
}

function chord(midis, duration) {
  return { rest: false, duration: duration || 'q', midi: midis[0], midis: midis.slice() };
}

test('acorde con nota grave: el pentagrama de sol conserva la octava y no lleva 8vb', () => {
  const n = chord([36, 64, 67], 'h');
  n.ottava = '8vb';
  const high = Staff.planNote(n, Staff.CLEF.TREBLE, Staff.BAND.HIGH);
  assert.deepStrictEqual(high.keys, ['e/4', 'g/4']);
  assert.strictEqual(high.ottava, null);
  const low = Staff.planNote(n, Staff.CLEF.BASS, Staff.BAND.LOW);
  assert.deepStrictEqual(low.keys, ['c/3']);
  assert.strictEqual(low.ottava, '8vb');
});

test('8vb en el pentagrama de fa mueve todo el acorde grave para no encimar octavas', () => {
  const low = Staff.planNote(chord([36, 48]), Staff.CLEF.BASS, Staff.BAND.LOW);
  assert.deepStrictEqual(low.keys, ['c/3', 'c/4']);
  assert.strictEqual(low.ottava, '8vb');
  const plain = Staff.planNote(chord([48, 52]), Staff.CLEF.BASS, Staff.BAND.LOW);
  assert.deepStrictEqual(plain.keys, ['c/3', 'e/3']);
  assert.strictEqual(plain.ottava, null);
});

test('usa la marca 8vb por nota del motor cuando viene', () => {
  const n = chord([40, 52]);
  n.ottavas = [null, null];
  assert.strictEqual(Staff.planNote(n, Staff.CLEF.BASS, Staff.BAND.LOW).ottava, null);
  n.ottavas = ['8vb', null];
  assert.strictEqual(Staff.planNote(n, Staff.CLEF.BASS, Staff.BAND.LOW).ottava, '8vb');
});

test('los silencios del pentagrama de fa van en d/3', () => {
  assert.strictEqual(Staff.restKey(Staff.CLEF.BASS), 'd/3');
  assert.strictEqual(Staff.restKey(Staff.CLEF.TREBLE), 'b/4');
  const rest = Staff.planNote({ rest: true, duration: 'qr', midi: null, midis: [] }, Staff.CLEF.BASS, Staff.BAND.LOW);
  assert.deepStrictEqual(rest.keys, ['d/3']);
  assert.strictEqual(rest.duration, 'qr');
  const onlyHigh = Staff.planNote(chord([72]), Staff.CLEF.BASS, Staff.BAND.LOW);
  assert.strictEqual(onlyHigh.rest, true);
  assert.deepStrictEqual(onlyHigh.keys, ['d/3']);
  assert.strictEqual(onlyHigh.duration, 'qr');
  assert.deepStrictEqual(Staff.planMeasure({ notes: [] }, Staff.CLEF.BASS, Staff.BAND.ALL)[0].keys, ['d/3']);
});

test('el gran pentagrama lleva llave, línea izquierda y compás en el pentagrama de fa', () => {
  const { log, VF } = fakeVexFlow();
  const data = { timeSigStr: '4/4', measures: [{ notes: [chord([36, 64, 67]), { rest: true, duration: 'qr', midi: null, midis: [] }] }, { notes: [chord([43, 72])] }] };
  Staff.draw(VF, {}, data, 358);
  assert.strictEqual(log.staves.length, 4);
  const [treble, bass, treble2, bass2] = log.staves;
  assert.deepStrictEqual(treble.mods, ['clef:treble', 'time:4/4']);
  assert.deepStrictEqual(bass.mods, ['clef:bass', 'time:4/4']);
  assert.deepStrictEqual(treble2.mods, ['clef:treble']);
  assert.deepStrictEqual(bass2.mods, ['clef:bass']);
  assert.strictEqual(treble.getNoteStartX(), bass.getNoteStartX());
  const types = log.connectors.filter(c => c.top === treble && c.bottom === bass && c.drawn).map(c => c.type).sort();
  assert.deepStrictEqual(types, ['brace', 'singleLeft']);
  assert.strictEqual(log.connectors.length, 4);
  const bassRests = log.notes.filter(n => n.clef === 'bass' && n.duration.endsWith('r'));
  assert.ok(bassRests.length >= 1);
  bassRests.forEach(n => assert.deepStrictEqual(n.keys, ['d/3']));
  const trebleNotes = log.notes.filter(n => n.clef === 'treble' && !n.duration.endsWith('r'));
  assert.deepStrictEqual(trebleNotes[0].keys, ['e/4', 'g/4']);
  log.annotations.forEach(a => assert.strictEqual(a.just, VF.Annotation.VerticalJustify.BOTTOM));
  const marked = log.notes.filter(n => n.mods.some(x => x.m instanceof VF.Annotation));
  assert.ok(marked.length >= 1);
  marked.forEach(n => assert.strictEqual(n.clef, 'bass'));
});

test('un solo pentagrama no dibuja llave', () => {
  const { log, VF } = fakeVexFlow();
  Staff.draw(VF, {}, { timeSigStr: '4/4', measures: [{ notes: [chord([60])] }, { notes: [chord([50])] }] }, 358);
  assert.strictEqual(log.connectors.length, 0);
  assert.deepStrictEqual(log.staves.map(s => s.clef), ['treble', 'bass']);
});
