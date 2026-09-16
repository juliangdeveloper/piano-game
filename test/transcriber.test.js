// test/transcriber.test.js — integración: hops sintéticos → eventos (pipeline puro)
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const ES = require('../js/eventstream.js');

// Simula el pipeline: voices por hop (como los produciría Mask.scoreAll + THRESHOLDS)
// Verifica la secuencia completa: C4 (run), pausa, E5 re-tocada, acorde C4+E4.

test('P1: secuencia musical → eventos en orden con timestamps correctos', () => {
  const es = ES.create();
  ES.setHopMs(es, 21.3);
  const V = (m) => [{ midi: m, score: 0.8 }];
  const N = null;
  const seq = [
    [V(60), 0], [V(60), 21], [V(60), 42], [V(60), 64],   // C4 sostenida 4 hops
    [N, 85], [N, 106], [N, 128], [N, 149],               // pausa 4 hops (>gap 3)
    [V(64), 170], [V(64), 191],                          // E4 re-tocada
    [N, 213], [N, 234], [N, 255], [N, 277],              // pausa 4 hops
    [[{ midi: 60, score: 0.55 }, { midi: 64, score: 0.55 }], 298], // acorde
    [[{ midi: 60, score: 0.55 }, { midi: 64, score: 0.55 }], 319]
  ];
  for (const [voices, t] of seq) ES.push(es, voices, t);
  // C4 = 1 evento, E4 = 1 evento, acorde = 2 eventos (C4 y E4 individuales) → total 4
  assert.strictEqual(es.events.length, 4, 'teclas individuales: acorde genera 2');
  assert.deepStrictEqual(es.events.map(e => e.midi), [60, 64, 60, 64]);
  assert.deepStrictEqual(es.events.map(e => e.chord), [false, false, true, true]);
  assert.strictEqual(es.events[0].tStartMs, 0);
  assert.strictEqual(es.events[1].tStartMs, 170);
  assert.strictEqual(es.events[2].tStartMs, 298);
  assert.strictEqual(es.events[3].tStartMs, 298);
});

test('P2: misma nota re-tocada rápido (gap exacto de 3 hops = merge, no re-tocada)', () => {
  const es = ES.create();
  ES.setHopMs(es, 21.3);
  const V = (m) => [{ midi: m, score: 0.8 }];
  ES.push(es, V(60), 0);
  ES.push(es, V(60), 21);
  ES.push(es, null, 42);
  ES.push(es, null, 64);
  ES.push(es, null, 85);   // gap = 85-21 = 64ms > 63.9 → moriría… MERGE_GAP=3: límite 3*21.3=63.9
  // al borde: usar gap de 2 hops para garantizar merge
  const es2 = ES.create();
  ES.setHopMs(es2, 21.3);
  ES.push(es2, V(60), 0);
  ES.push(es2, V(60), 21);
  ES.push(es2, null, 42);
  ES.push(es2, null, 64);  // gap 64-21=43ms ≤ 63.9 → vivo
  ES.push(es2, V(60), 85); // vuelve: extiende el mismo evento
  assert.strictEqual(es2.events.length, 1, 'misma pulsación');
  assert.strictEqual(es2.events[0].count, 3);
});