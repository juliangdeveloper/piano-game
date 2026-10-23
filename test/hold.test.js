'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const Hold = require('../js/hold.js');

const N = (name, octave) => ({ name, octave, cents: 0, midi: 0 });

function run(state, notes) {
  return notes.map((n) => Hold.update(n, state));
}

test('T1: nota se vuelve estable tras 3 frames consecutivos (R4)', () => {
  const s = Hold.createState();
  const r1 = Hold.update(N('A', 4), s);
  assert.strictEqual(r1.display, null, 'frame 1 aún no consolidado y sin estable previa → null');
  assert.strictEqual(r1.changed, false);
  Hold.update(N('A', 4), s);
  const r3 = Hold.update(N('A', 4), s);
  assert.deepStrictEqual(
    { name: r3.display.name, octave: r3.display.octave },
    { name: 'A', octave: 4 }
  );
  assert.strictEqual(r3.changed, true, 'primera consolidación = cambio (loguea)');
});

test('T2: 2 frames con otra nota NO sueltan la estable (R4: contador por nota)', () => {
  const s = Hold.createState();
  run(s, [N('A', 4), N('A', 4), N('A', 4)]);
  const r = run(s, [N('C', 4), N('C', 4)]);
  r.forEach((x, i) => {
    assert.deepStrictEqual(
      { name: x.display.name, octave: x.display.octave },
      { name: 'A', octave: 4 },
      `frame ${i}: candidata C4 sin consolidar → sigue A4`
    );
    assert.strictEqual(x.changed, false);
  });
  const r3 = Hold.update(N('C', 4), s);
  assert.strictEqual(r3.changed, true);
  assert.strictEqual(r3.display.name, 'C');
});

test('T3: gap de 2 frames mantiene la nota (R10 hold), no re-loguea', () => {
  const s = Hold.createState();
  run(s, [N('A', 4), N('A', 4), N('A', 4)]);
  const gaps = run(s, [null, null]);
  gaps.forEach((x, i) => {
    assert.deepStrictEqual(
      { name: x.display.name, octave: x.display.octave },
      { name: 'A', octave: 4 },
      `gap ${i}: hold mantiene A4`
    );
    assert.strictEqual(x.changed, false, 'hold no re-loguea');
  });
  const back = run(s, [N('A', 4), N('A', 4), N('A', 4)]);
  assert.strictEqual(back[2].changed, false, 'misma nota tras gap corto NO re-loguea (R10)');
  assert.strictEqual(back[0].display.name, 'A');
});

test('T4: gap > 15 frames suelta a null (R10 límite)', () => {
  const s = Hold.createState();
  run(s, [N('A', 4), N('A', 4), N('A', 4)]);
  const longGap = run(s, new Array(Hold.HOLD_FRAMES + 1).fill(null));
  assert.strictEqual(longGap[Hold.HOLD_FRAMES - 1].display.name, 'A', 'frame 15 de gap: aún en hold');
  assert.strictEqual(longGap[Hold.HOLD_FRAMES].display, null, 'frame 16: suelta');
  const again = run(s, [N('A', 4), N('A', 4), N('A', 4)]);
  assert.strictEqual(again[2].changed, true, 'tras pausa larga, misma nota SÍ re-loguea');
});

test('T5: gap de 1 frame en medio de consolidación no rompe el contador R4', () => {
  const s = Hold.createState();
  run(s, [N('G', 3), N('G', 3), N('G', 3)]);
  run(s, [N('C', 4), N('C', 4)]);
  const r = run(s, [null]);
  assert.strictEqual(r[0].display.name, 'G', 'hold mantiene G3, contador de C4 se resetea');
  const r2 = run(s, [N('C', 4), N('C', 4), N('C', 4)]);
  assert.strictEqual(r2[2].changed, true, 'C4 consolida tras reiniciar contador');
});

test('T6: transición de nota loguea exactamente una vez', () => {
  const s = Hold.createState();
  const seq = run(s, [N('A', 4), N('A', 4), N('A', 4), N('A', 4), N('A', 4), N('B', 4), N('B', 4), N('B', 4), N('B', 4)]);
  const changedCount = seq.filter((x) => x.changed).length;
  assert.strictEqual(changedCount, 2, 'A4 y B4: un changed cada una');
});


test('T7: midiUpdate note-on muestra al instante y loguea cambios', () => {
  const s = Hold.createState();
  const r1 = Hold.midiUpdate(s, N('C', 4));
  assert.strictEqual(r1.display.name, 'C', 'note-on displays inmediato (sin esperar 3 frames)');
  assert.strictEqual(r1.changed, true, 'primera nota loguea');
  const r2 = Hold.midiUpdate(s, N('C', 4));
  assert.strictEqual(r2.changed, false, 'misma tecla sostenida no re-loguea');
  const r3 = Hold.midiUpdate(s, N('E', 4));
  assert.strictEqual(r3.display.name, 'E');
  assert.strictEqual(r3.changed, true, 'cambio de tecla loguea');
});

test('T8: midiUpdate note-off cae al instante y la siguiente nota re-loguea', () => {
  const s = Hold.createState();
  Hold.midiUpdate(s, N('C', 4));
  const off = Hold.midiUpdate(s, null);
  assert.strictEqual(off.display, null, 'note-off → display null inmediato (dial: al instante)');
  assert.strictEqual(off.changed, false, 'note-off no loguea');
  const again = Hold.midiUpdate(s, N('C', 4));
  assert.strictEqual(again.changed, true, 'misma nota tras note-off SÍ loguea (nueva pulsación)');
});