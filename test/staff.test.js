'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const Staff = require('../js/staff.js');

function fakeVexFlow(noteWidth = 20) {
  const log = { all: [], connectors: [], notes: [], brackets: [], beams: [], scale: null, get staves() { return this.all.filter(s => s.drawn); } };
  class Stave {
    constructor(x, y, w) { this.x = x; this.y = y; this.w = w; this.mods = []; this.start = x + 40; log.all.push(this); }
    getNoteEndX() { return this.x + this.w - 10; }
    setEndBarType(t) { this.endBar = t; return this; }
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
  class TextBracket {
    constructor(o) { Object.assign(this, o); this.textElement = { setFont() {} }; this.superscriptElement = { setFont() {} }; log.brackets.push(this); }
    setLine(l) { this.line = l; return this; }
    setContext() { return this; }
    draw() { this.drawn = true; return this; }
  }
  TextBracket.Position = { TOP: 1, BOTTOM: -1 };
  class Beam {
    static getDefaultBeamGroups() { return ['1/4']; }
    static generateBeams(notes) { const b = { notes, setContext() { return this; }, draw() { this.drawn = true; return this; } }; log.beams.push(b); return [b]; }
  }
  class Voice {
    constructor() { this.tickables = []; }
    setMode() { return this; }
    addTickables(t) { this.tickables = this.tickables.concat(t); return this; }
    draw(ctx, stave) { this.stave = stave; }
  }
  Voice.Mode = { SOFT: 2 };
  class Formatter {
    constructor() { this.voices = []; }
    joinVoices(v) { this.voices = this.voices.concat(v); return this; }
    preCalculateMinTotalWidth(voices) { return Math.max(...voices.map(v => v.tickables.length)) * noteWidth; }
    formatToStave() { return this; }
  }
  class Renderer { constructor() {} resize(w, h) { log.size = [w, h]; } getContext() { return { scale(x) { log.scale = x; }, openGroup() {}, closeGroup() {} }; } }
  Renderer.Backends = { SVG: 2 };
  Stave.defaultPadding = 22;
  return { log, VF: { Stave, StaveConnector, StaveNote, Accidental, TextBracket, Beam, Barline: { type: { NONE: 'none' } }, Voice, Formatter, Renderer } };
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
  const drawnBrackets = log.brackets.filter(b => b.drawn);
  assert.strictEqual(drawnBrackets.length, 2);
  drawnBrackets.forEach(br => {
    assert.strictEqual(br.position, VF.TextBracket.Position.BOTTOM);
    assert.strictEqual(br.text + br.superscript, '8vb');
    assert.strictEqual(br.start.clef, 'bass');
    assert.strictEqual(br.stop.clef, 'bass');
  });
});

test('un solo pentagrama no dibuja llave', () => {
  const { log, VF } = fakeVexFlow();
  Staff.draw(VF, {}, { timeSigStr: '4/4', measures: [{ notes: [chord([60])] }, { notes: [chord([50])] }] }, 358);
  assert.strictEqual(log.connectors.length, 0);
  assert.deepStrictEqual(log.staves.map(s => s.clef), ['treble', 'bass']);
});

function realVexFlow() {
  const VF = require('../js/vexflow.js');
  VF.Element.setTextMeasurementCanvas({
    getContext() {
      return { font: '', measureText(t) { return { width: 7 * String(t).length, fontBoundingBoxAscent: 8, fontBoundingBoxDescent: 2, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 7 * String(t).length }; } };
    }
  });
  return VF;
}

function rest(duration) {
  return { rest: true, duration, midi: null, midis: [] };
}

function beamIndexes(built, voice) {
  const notes = built.voices[voice].getTickables();
  return built.beams
    .filter(b => notes.includes(b.getNotes()[0]))
    .map(b => b.getNotes().map(n => notes.indexOf(n)));
}

test('corcheas y semicorcheas se agrupan con barra por tiempo', () => {
  const VF = realVexFlow();
  const measure = { notes: [chord([60], '8'), chord([64], '8'), chord([67], '16'), chord([69], '16'), chord([71], '16'), chord([72], '16'), chord([74], 'q'), chord([76], '8'), chord([77], '8')] };
  const built = Staff.buildMeasure(VF, Staff.makeRow(measure, Staff.KIND.TREBLE, 0, 0, measure.notes.length), '4/4', 0, 320);
  assert.deepStrictEqual(beamIndexes(built, 0), [[0, 1], [2, 3, 4, 5], [7, 8]]);
});

test('los silencios cortan las barras', () => {
  const VF = realVexFlow();
  const measure = { notes: [chord([60], '8'), rest('8r'), chord([64], '16'), chord([65], '16'), rest('16r'), chord([67], '16'), chord([69], '8'), chord([71], '8'), chord([72], 'q')] };
  const built = Staff.buildMeasure(VF, Staff.makeRow(measure, Staff.KIND.TREBLE, 0, 0, measure.notes.length), '4/4', 0, 320);
  const groups = beamIndexes(built, 0);
  assert.deepStrictEqual(groups, [[2, 3], [6, 7]]);
  const notes = built.voices[0].getTickables();
  built.beams.forEach(b => b.getNotes().forEach(n => assert.strictEqual(notes[notes.indexOf(n)].isRest(), false)));
});

test('en el gran pentagrama las barras van por separado en sol y en fa', () => {
  const VF = realVexFlow();
  const measure = { notes: [chord([40, 64], '8'), chord([43, 67], '8'), chord([72], '8'), chord([74], '8'), chord([45], '8'), chord([47], '8'), chord([48, 76], 'q')] };
  const built = Staff.buildMeasure(VF, Staff.makeRow(measure, Staff.KIND.GRAND, 0, 0, measure.notes.length), '4/4', 0, 320);
  assert.deepStrictEqual(beamIndexes(built, 0), [[0, 1], [2, 3]]);
  assert.deepStrictEqual(beamIndexes(built, 1), [[0, 1], [4, 5]]);
  const high = built.voices[0].getTickables();
  const low = built.voices[1].getTickables();
  built.beams.forEach(b => {
    const inHigh = b.getNotes().every(n => high.includes(n));
    const inLow = b.getNotes().every(n => low.includes(n));
    assert.ok(inHigh !== inLow);
  });
  assert.strictEqual(high[2].getStemDirection(), VF.Stem.DOWN);
});

test('compases densos en pantalla angosta se parten por tiempos y no se encogen de más', () => {
  const { log, VF } = fakeVexFlow(40);
  const notes = [];
  for (let i = 0; i < 16; i++) notes.push(chord([61 + i], '16'));
  assert.deepStrictEqual(Staff.beatSplits(notes), [4, 8, 12, 16]);
  const box = Staff.draw(VF, {}, { timeSigStr: '4/4', measures: [{ notes }] }, 358);
  assert.ok(box.rows.length > 1);
  assert.ok(box.scale >= Staff.LAYOUT.MIN_SCALE);
  const drawn = log.staves;
  assert.strictEqual(drawn.length, box.rows.length);
  drawn.slice(0, -1).forEach(s => assert.strictEqual(s.endBar, 'none'));
  assert.strictEqual(drawn[drawn.length - 1].endBar, undefined);
  assert.ok(drawn[0].mods.includes('time:4/4'));
  assert.ok(!drawn[1].mods.includes('time:4/4'));
});

test('un compás que no cabe ensancha el pentagrama y escala el dibujo al ancho disponible', () => {
  const { log, VF } = fakeVexFlow(26);
  const notes = [];
  for (let i = 0; i < 9; i++) notes.push(chord([60 + i], i < 8 ? '16' : 'h'));
  const box = Staff.draw(VF, {}, { timeSigStr: '4/4', measures: [{ notes }] }, 358);
  assert.strictEqual(box.rows.length, 1);
  assert.ok(box.staveWidth > 356 - Staff.LAYOUT.LEFT_X - Staff.LAYOUT.RIGHT_ROOM);
  assert.ok(box.scale < 1);
  assert.strictEqual(log.scale, box.scale);
  assert.deepStrictEqual(log.size, [box.displayWidth, box.displayHeight]);
  const st = log.staves[0];
  assert.ok(st.getNoteEndX() - st.getNoteStartX() - VF.Stave.defaultPadding >= 9 * 26);
});
