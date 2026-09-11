// test/hold.test.js — TDD para la máquina de estados R4+R10 (js/hold.js)
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const Hold = require('../js/hold.js');

const N = (name, octave) => ({ name, octave, cents: 0, midi: 0 });

function run(state, notes) {
  // notes: array de nota|null; retorna array de resultados {display, changed}
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
  run(s, [N('A', 4), N('A', 4), N('A', 4)]); // A4 estable
  const r = run(s, [N('C', 4), N('C', 4)]);
  r.forEach((x, i) => {
    assert.deepStrictEqual(
      { name: x.display.name, octave: x.display.octave },
      { name: 'A', octave: 4 },
      `frame ${i}: candidata C4 sin consolidar → sigue A4`
    );
    assert.strictEqual(x.changed, false);
  });
  // tercer frame C4 consolida → changed true
  const r3 = Hold.update(N('C', 4), s);
  assert.strictEqual(r3.changed, true);
  assert.strictEqual(r3.display.name, 'C');
});

test('T3: gap de 2 frames mantiene la nota (R10 hold), no re-loguea', () => {
  const s = Hold.createState();
  run(s, [N('A', 4), N('A', 4), N('A', 4)]); // A4 estable
  const gaps = run(s, [null, null]);
  gaps.forEach((x, i) => {
    assert.deepStrictEqual(
      { name: x.display.name, octave: x.display.octave },
      { name: 'A', octave: 4 },
      `gap ${i}: hold mantiene A4`
    );
    assert.strictEqual(x.changed, false, 'hold no re-loguea');
  });
  // vuelve la señal: 1 frame basta porque la candidata vuelve a contar desde 1... 
  // pero A4 ya es estable: tras 3 frames de señal vuelve a consolidar SIN changed
  const back = run(s, [N('A', 4), N('A', 4), N('A', 4)]);
  assert.strictEqual(back[2].changed, false, 'misma nota tras gap corto NO re-loguea (R10)');
  assert.strictEqual(back[0].display.name, 'A');
});

test('T4: gap > 15 frames suelta a null (R10 límite)', () => {
  const s = Hold.createState();
  run(s, [N('A', 4), N('A', 4), N('A', 4)]);
  const longGap = run(s, new Array(Hold.HOLD_FRAMES + 1).fill(null));
  // los primeros HOLD_FRAMES gaps mantienen; el último suelta
  assert.strictEqual(longGap[Hold.HOLD_FRAMES - 1].display.name, 'A', 'frame 15 de gap: aún en hold');
  assert.strictEqual(longGap[Hold.HOLD_FRAMES].display, null, 'frame 16: suelta');
  // tras soltar, la misma nota se consolida y SÍ loguea (pausa larga = re-loguea)
  const again = run(s, [N('A', 4), N('A', 4), N('A', 4)]);
  assert.strictEqual(again[2].changed, true, 'tras pausa larga, misma nota SÍ re-loguea');
});

test('T5: gap de 1 frame en medio de consolidación no rompe el contador R4', () => {
  // hoy: 2 ok + 1 gap + 1 ok → display null (bug v1.0); con hold: mantiene estable previa si existía
  const s = Hold.createState();
  run(s, [N('G', 3), N('G', 3), N('G', 3)]); // G3 estable
  run(s, [N('C', 4), N('C', 4)]); // candidata C4 ×2
  const r = run(s, [null]); // gap 1
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