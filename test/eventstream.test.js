// test/eventstream.test.js — TDD para js/eventstream.js (R16/R17: hops → eventos, merge)
// Semántica v2: evento se EMITE cuando el run llega a MIN_RUN hops (lista en vivo,
// ~42ms tras el onset) y se EXTIENDE in-place mientras la nota siga / vuelva en gap corto.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const ES = require('../js/eventstream.js');

const h = (midi, score) => (midi == null ? null : { midi, score: score == null ? 1 : score });
const T = (i) => i * 21.3; // hop i

function newEs() { const es = ES.create(); ES.setHopMs(es, 21.3); return es; }

test('E1: run de 2 hops → evento emitido inmediatamente (en vivo, no al morir el run)', () => {
  const es = newEs();
  ES.push(es, h(60), T(0));
  assert.strictEqual(es.events.length, 0, '1 hop: aún no');
  const out = ES.push(es, h(60), T(1));
  assert.strictEqual(es.events.length, 1, '2 hops: emitido');
  assert.strictEqual(out.newEvents.length, 1);
  assert.strictEqual(es.events[0].midi, 60);
  assert.strictEqual(es.events[0].count, 2);
  assert.strictEqual(es.events[0].tStartMs, T(0));
  assert.strictEqual(es.events[0].tEndMs, T(1));
});

test('E2: 1 hop aislado no genera evento (ruido/ataque espurio)', () => {
  const es = newEs();
  ES.push(es, h(72), T(0));
  ES.push(es, null, T(1));
  ES.push(es, null, T(2));
  ES.push(es, null, T(3));
  ES.push(es, null, T(4));
  assert.strictEqual(es.events.length, 0);
});

test('E3: run largo extiende el MISMO evento in-place (count sube, sin duplicados)', () => {
  const es = newEs();
  ES.push(es, h(60), T(0));
  ES.push(es, h(60), T(1));
  ES.push(es, h(60), T(2));
  ES.push(es, h(60), T(3));
  assert.strictEqual(es.events.length, 1);
  assert.strictEqual(es.events[0].count, 4);
  assert.strictEqual(es.events[0].tEndMs, T(3));
  assert.strictEqual(es.events[0].tStartMs, T(0));
});

test('E4: gap > 3 hops de la misma nota → evento NUEVO (re-tocada real, gap ≥ 300ms)', () => {
  const es = newEs();
  ES.push(es, h(60), T(0));
  ES.push(es, h(60), T(1));
  for (let i = 2; i <= 16; i++) ES.push(es, null, i * 21.3); // gap ~320ms: re-tocada humana
  ES.push(es, h(60), T(17)); // re-tocada: run nuevo (count 1, sin emitir aún)
  const out = ES.push(es, h(60), T(18)); // consolida → evento nuevo
  assert.strictEqual(es.events.length, 2);
  assert.strictEqual(out.newEvents.length, 1);
  assert.strictEqual(es.events[1].tStartMs, T(17));
  assert.strictEqual(es.events[0].tStartMs, T(0));
});

test('E4b: cola decaída (<RESONANCE_MS, score menor) = misma pulsación resonando → extiende', () => {
  const es = newEs();
  ES.push(es, h(60, 0.9), T(0));
  ES.push(es, h(60, 0.9), T(1));
  ES.push(es, null, T(2));
  ES.push(es, null, T(3));
  ES.push(es, null, T(4));
  ES.push(es, null, T(5));
  ES.push(es, null, T(6));
  // la cola reaparece DECAÍDA (0.5 < 0.9*0.95) a ~150ms → merge con el evento
  ES.push(es, h(60, 0.5), T(7));
  ES.push(es, h(60, 0.4), T(8));
  assert.strictEqual(es.events.length, 1, 'cola decaída = mismo evento');
  assert.strictEqual(es.events[0].count, 4, '2 iniciales + 2 de la cola');
});

test('E3b: gap de ≤3 hops entre runs de la misma nota → MISMO evento extendido', () => {
  const es = newEs();
  ES.push(es, h(60), T(0));
  ES.push(es, h(60), T(1));
  ES.push(es, null, T(2));
  ES.push(es, null, T(3));
  ES.push(es, null, T(4)); // 3 hops de silencio: dentro del gap (42→ T(4)=85, tEnd=T(1)=21 → diff 64ms > 3*21.3=64? justo límite, uso T(4): 85-21=64 ≤ 63.9 falso... MERGE_GAP=3 → límite 63.9; este hop 64>63.9 mata)
  // por eso este test usa gap de 2 hops reales + el hop de vuelta
  ES.push(es, h(60), T(5));
  assert.strictEqual(es.events.length, 1, 'misma nota tras gap corto = mismo evento');
  assert.strictEqual(es.events[0].count, 3, '2 iniciales + vuelta');
});

test('E5: cambio de nota → run independiente (el 60 emitido queda intacto, el 64 corre su propio run)', () => {
  const es = newEs();
  ES.push(es, h(60), T(0));
  ES.push(es, h(60), T(1));
  ES.push(es, h(64), T(2)); // 60 ya emitido; 64 inicia run propio
  assert.strictEqual(es.events.length, 1, 'solo 60 emitido');
  assert.strictEqual(es.events[0].midi, 60);
  assert.strictEqual(es.pending.length, 2, '60 sigue vivo (se extiende) + run de 64');
  ES.push(es, h(64), T(3));
  assert.strictEqual(es.events.length, 2, '64 consolida con su 2º hop');
  assert.strictEqual(es.events[1].midi, 64);
  assert.strictEqual(es.events[1].count, 2);
});

test('E6: acorde 2 notas simultáneas → 2 eventos mismo tStart; ♪♪ SOLO tras coexistir ≥3 hops (filtro de transitorios)', () => {
  const es = newEs();
  ES.push(es, [{ midi: 60, score: 0.6 }, { midi: 64, score: 0.6 }], T(0));
  ES.push(es, [{ midi: 60, score: 0.6 }, { midi: 64, score: 0.6 }], T(1));
  // aún NO confirmado: transitorio de ataque típico (1-2 hops de coexistencia)
  assert.strictEqual(es.events[0].chord, false, '2 hops juntos: aún sin confirmar ♪♪');
  assert.strictEqual(es.events[1].chord, false);
  const out = ES.push(es, [{ midi: 60, score: 0.6 }, { midi: 64, score: 0.6 }], T(2));
  assert.strictEqual(es.events[0].chord, true, '3 hops coexistiendo: acorde confirmado');
  assert.strictEqual(es.events[1].chord, true);
  assert.strictEqual(es.events[0].midi, 60);
  assert.strictEqual(es.events[1].midi, 64);
  assert.strictEqual(es.events[0].tStartMs, T(0));
  assert.strictEqual(es.events[1].tStartMs, T(0), 'mismo onset');
  // NOTA: la confirmación del acorde MUTA el evento in-place (newEvents ya se
  // emitió con el 2º hop); out.newEvents=[] en el 3er push es lo esperado.
});

test('E6b: 2 voces solo 2 hops (transitorio de ataque) → sin ♪♪ en ninguna', () => {
  const es = newEs();
  ES.push(es, [{ midi: 60, score: 0.6 }, { midi: 64, score: 0.5 }], T(0));
  ES.push(es, [{ midi: 60, score: 0.6 }, { midi: 64, score: 0.5 }], T(1));
  ES.push(es, [{ midi: 60, score: 0.6 }], T(2)); // la 2ª voz muere (transitorio)
  ES.push(es, [{ midi: 60, score: 0.6 }], T(3));
  const chords = es.events.map(e => e.chord);
  assert.ok(chords.every(c => c === false), 'coexistencia < 3 hops: nada lleva ♪♪ — ' + JSON.stringify(es.events.map(e => [e.midi, e.chord])));
});

test('E6c: acorde confirmado que luego muere por gap → conserva ♪♪', () => {
  const es = newEs();
  for (let i = 0; i < 4; i++) {
    ES.push(es, [{ midi: 60, score: 0.6 }, { midi: 64, score: 0.6 }], T(i));
  }
  assert.strictEqual(es.events[0].chord, true);
  for (let i = 4; i <= 8; i++) ES.push(es, null, T(i)); // gap largo: pendings mueren
  assert.strictEqual(es.events[0].chord, true, 'confirmado = permanente');
});

test('E7: backfill — hops desordenados se ordenan antes de procesar', () => {
  const es = newEs();
  ES.pushBatch(es, [
    { voices: h(60), tMs: T(2) },
    { voices: h(60), tMs: T(0) }, // llega tarde
    { voices: h(60), tMs: T(1) }
  ]);
  assert.strictEqual(es.events.length, 1);
  assert.strictEqual(es.events[0].tStartMs, T(0), 'tStart es el más antiguo');
  assert.strictEqual(es.events[0].count, 3);
});

test('E8: reset limpia todo (nueva sesión)', () => {
  const es = newEs();
  ES.push(es, h(60), T(0));
  ES.push(es, h(60), T(1));
  ES.reset(es);
  assert.strictEqual(es.events.length, 0);
  assert.strictEqual(es.pending.length, 0);
});
test('E7b: C resonando + D nueva → solo D es onset nuevo (C es resonancia, no re-loguea)', () => {
  const es = newEs();
  // C4 suena y se consolida
  ES.push(es, h(60), T(0));
  ES.push(es, h(60), T(1));
  ES.push(es, h(60), T(2));
  assert.strictEqual(es.events.length, 1);
  // D4 tocada a +200ms: hops sucesivos traen C4 (decay) + D4 (onset sostenido)
  for (let i = 10; i <= 13; i++) {
    ES.push(es, [{ midi: 60, score: 0.5 }, { midi: 62, score: 0.8 }], T(i));
  }
  // C4: resonancia → sigue siendo EL MISMO evento viejo (count crece, sin evento nuevo de C4)
  // D4: onset nuevo → SU evento propio
  assert.strictEqual(es.events.length, 2, 'C4 + D4, sin duplicado de C4');
  assert.strictEqual(es.events[0].midi, 60);
  assert.strictEqual(es.events[0].count, 7, 'C4 extendida por resonancia');
  assert.strictEqual(es.events[1].midi, 62);
  assert.strictEqual(es.events[1].tStartMs, T(10));
});

test('E7c: acorde REAL C4+E4 (ambos sin historia) → ambos onsets nuevos', () => {
  const es = newEs();
  // G3 antes para dar historia al stream
  ES.push(es, h(55), T(0));
  ES.push(es, h(55), T(1));
  // acorde C4+E4 sostenido (ninguno tocado antes): 3 hops coexistiendo
  for (let i = 8; i <= 10; i++) {
    ES.push(es, [{ midi: 60, score: 0.6 }, { midi: 64, score: 0.6 }], T(i));
  }
  const midis = es.events.map(e => e.midi).sort();
  assert.deepStrictEqual(midis, [55, 60, 64], 'acorde real: ambas voces son onsets nuevos');
  assert.strictEqual(es.events[1].chord, true, '♪♪ confirmado (3 hops coexistiendo)');
});

test('E7d: resonancia + vecino fantasma (C sonando, C# fuga al onset de D)', () => {
  const es = newEs();
  ES.push(es, h(60), T(0));
  ES.push(es, h(60), T(1));
  // D2 no: usar D4(62) nueva con C4 decay + C#4 fuga: hop trae 3 notas pero MAX_VOICES=2 toma las 2 más fuertes
  // C#4 (61) es vecino de C4 (60) → fantasma; C4 resonancia; D4 nueva
  for (let i = 10; i <= 12; i++) {
    ES.push(es, [{ midi: 61, score: 0.7 }, { midi: 62, score: 0.7 }], T(i));
  }
  const midis = es.events.map(e => e.midi);
  assert.ok(!midis.includes(61), 'C#4 vecino-fantasma de C4 no se loguea');
  assert.strictEqual(midis.filter(m => m === 62).length, 1, 'D4 se loguea una vez');
  assert.strictEqual(es.events.filter(e => e.midi === 60).length, 1, 'C4 sigue siendo su evento original');
});
