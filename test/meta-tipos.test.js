'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const Meta = require('../js/meta.js');
const Progress = require('../js/progress.js');

function memoryStorage() {
  const data = {};
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); }
  };
}

function env(storage, ms, declared) {
  const win = { location: { origin: 'https://example.test', search: '' } };
  win.parent = win;
  return { localStorage: storage, now: new Date(ms), nowMs: ms, window: win, declared: declared, force: true };
}

test('los enums están congelados y PROYECTO usa sus valores', () => {
  for (const e of [Meta.FASE, Meta.ESTADO_FASE, Meta.TIPO_STAT, Progress.STATS]) assert.ok(Object.isFrozen(e));
  assert.deepStrictEqual(Object.values(Meta.FASE), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepStrictEqual(Object.values(Meta.ESTADO_FASE), [0, 1, 2, 3, 4]);
  assert.strictEqual(Meta.PROYECTO.fase, Meta.FASE.DISENO);
  assert.strictEqual(Meta.PROYECTO.fase_estado, Meta.ESTADO_FASE.EN_CURSO);
  assert.deepStrictEqual(Meta.metaProyecto(Meta.PROYECTO), Object.assign({}, Meta.PROYECTO));
});

test('cada stat declara un tipo válido y una unidad, y la mezcla respeta su tipo', () => {
  const tipos = Object.values(Meta.TIPO_STAT);
  const keys = Object.keys(Progress.STATS);
  assert.ok(keys.length >= 1 && keys.length <= 20);
  for (const key of keys) {
    assert.ok(tipos.includes(Progress.STATS[key].tipo), key);
    assert.ok(typeof Progress.STATS[key].unidad === 'string' && Progress.STATS[key].unidad.length > 0, key);
  }
  const declared = Object.assign({}, Progress.STATS, { en_curso: { tipo: Meta.TIPO_STAT.VALOR_ACTUAL, unidad: 'prueba' } });
  const storage = memoryStorage();
  const alto = {};
  const bajo = {};
  for (const key of Object.keys(declared)) { alto[key] = 10; bajo[key] = 3; }
  const t0 = Date.parse('2026-10-23T18:00:00.000Z');
  Meta.metaUpdate('piano-transcribe', '1', { stats: alto, logros: [] }, env(storage, t0, declared));
  const record = Meta.metaUpdate('piano-transcribe', '1', { stats: bajo, logros: [] }, env(storage, t0 + 2000, declared));
  for (const key of Object.keys(declared)) {
    assert.strictEqual(record.stats[key], declared[key].tipo === Meta.TIPO_STAT.VALOR_ACTUAL ? 3 : 10, key);
  }
});
