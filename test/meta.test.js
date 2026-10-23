// test/meta.test.js — meta.v1 y la migración del progreso de piano-transcribe.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const Meta = require('../js/meta.js');
const Progress = require('../js/progress.js');

const SLUG = 'piano-transcribe';
const KEY = 'meta.v1.piano-transcribe';
const WHEN = new Date('2026-10-23T18:00:00.000Z');

function memoryStorage(initial) {
  const data = Object.assign({}, initial || {});
  return {
    getItem: function (key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem: function (key, value) {
      data[key] = String(value);
    },
    dump: function () {
      return data;
    }
  };
}

function sameWindow() {
  const win = { location: { origin: 'https://juliangdeveloper.github.io' } };
  win.parent = win;
  win.postMessage = function () {
    throw new Error('no debería publicar en la propia ventana');
  };
  return win;
}

function zeros() {
  return {
    sessions: 0,
    notes_captured_total: 0,
    longest_session_notes: 0,
    chords_captured: 0
  };
}

test('un guardado viejo sin la clave meta produce ceros y no toca las claves existentes', () => {
  const storage = memoryStorage({
    'piano-transcribe.source': 'midi',
    'piano-game.source': 'mic',
    'piano-transcribe.engine': '1.11.0'
  });
  const record = Meta.metaBackfill(SLUG, '1.12.0', Progress.deriveLegacy, {
    localStorage: storage,
    now: WHEN,
    window: sameWindow()
  });
  assert.deepStrictEqual(record, {
    v: 1,
    slug: SLUG,
    version: '1.12.0',
    updatedAt: '2026-10-23T18:00:00.000Z',
    stats: zeros(),
    logros: [],
    hitos: {}
  });
  assert.deepStrictEqual(JSON.parse(storage.getItem(KEY)), record);
  assert.strictEqual(storage.getItem('piano-transcribe.source'), 'midi');
  assert.strictEqual(storage.getItem('piano-game.source'), 'mic');
  assert.strictEqual(storage.getItem('piano-transcribe.engine'), '1.11.0');
  assert.deepStrictEqual(Object.keys(storage.dump()).sort(), [
    'meta.v1.piano-transcribe',
    'piano-game.source',
    'piano-transcribe.engine',
    'piano-transcribe.source'
  ]);
});

test('un registro meta ya válido no se reescribe en el backfill', () => {
  const existing = {
    v: 1,
    slug: SLUG,
    version: '1.11.0',
    updatedAt: '2026-01-01T00:00:00.000Z',
    stats: {
      sessions: 3,
      notes_captured_total: 9,
      longest_session_notes: 4,
      chords_captured: 1
    },
    logros: ['first_note', 'first_session'],
    hitos: {
      first_note: '2026-01-01T00:00:00.000Z',
      first_session: '2026-01-01T00:00:00.000Z'
    }
  };
  const raw = JSON.stringify(existing);
  let writes = 0;
  const storage = {
    getItem: function (key) { return key === KEY ? raw : null; },
    setItem: function () { writes += 1; }
  };
  const back = Meta.metaBackfill(SLUG, '1.12.0', Progress.deriveLegacy, {
    localStorage: storage,
    now: WHEN,
    window: sameWindow()
  });
  assert.strictEqual(writes, 0);
  assert.strictEqual(back.updatedAt, '2026-01-01T00:00:00.000Z');
  assert.strictEqual(back.version, '1.11.0');
  assert.deepStrictEqual(back.stats, existing.stats);
  assert.deepStrictEqual(back.hitos, existing.hitos);
});

test('un JSON corrupto no rompe el backfill y deja un registro válido', () => {
  const storage = memoryStorage({ 'piano-transcribe.source': 'mic' });
  storage.setItem(KEY, '{');
  let record;
  assert.doesNotThrow(function () {
    record = Meta.metaBackfill(SLUG, '1.12.0', function () {
      throw new Error('derive no debería impedir el registro');
    }, {
      localStorage: storage,
      now: WHEN,
      window: sameWindow()
    });
  });
  assert.strictEqual(record.v, 1);
  assert.strictEqual(record.slug, SLUG);
  assert.deepStrictEqual(record.stats, {});
  assert.deepStrictEqual(record.logros, []);
  assert.deepStrictEqual(record.hitos, {});
  assert.strictEqual(storage.getItem('piano-transcribe.source'), 'mic');
  assert.doesNotThrow(function () { JSON.parse(storage.getItem(KEY)); });
});

test('metaUpdate une logros, conserva hitos y descarta números no finitos', () => {
  const storage = memoryStorage();
  const env = { localStorage: storage, now: WHEN, window: sameWindow() };
  Meta.metaUpdate(SLUG, '1.12.0', {
    stats: { sessions: 1, notes_captured_total: 4, chords_captured: 0 },
    logros: ['first_note']
  }, env);
  const second = Meta.metaUpdate(SLUG, '1.12.0', {
    stats: {
      sessions: 2,
      notes_captured_total: NaN,
      longest_session_notes: Infinity,
      best_title: 'Do mayor'
    },
    logros: ['ten_notes', 'first_note', 'first_note']
  }, {
    localStorage: storage,
    now: new Date('2026-10-23T19:00:00.000Z'),
    window: sameWindow()
  });
  assert.strictEqual(second.stats.sessions, 2);
  assert.strictEqual(second.stats.notes_captured_total, 4);
  assert.strictEqual(second.stats.chords_captured, 0);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(second.stats, 'longest_session_notes'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(second.stats, 'best_title'), false);
  assert.deepStrictEqual(second.logros, ['first_note', 'ten_notes']);
  assert.strictEqual(second.hitos.first_note, '2026-10-23T18:00:00.000Z');
  assert.strictEqual(second.hitos.ten_notes, '2026-10-23T19:00:00.000Z');
  assert.deepStrictEqual(Object.keys(second.hitos).sort(), second.logros.slice().sort());
});

test('metaUpdate avisa al padre y no lanza si el almacenamiento falla', () => {
  const storage = memoryStorage();
  const messages = [];
  const win = {
    location: { origin: 'https://juliangdeveloper.github.io' },
    parent: {
      postMessage: function (data, origin) {
        messages.push({ data: data, origin: origin });
      }
    }
  };
  const record = Meta.metaUpdate(SLUG, '1.12.0', {
    stats: { sessions: 1 },
    logros: ['first_session']
  }, { localStorage: storage, now: WHEN, window: win });
  assert.strictEqual(messages.length, 1);
  assert.strictEqual(messages[0].origin, 'https://juliangdeveloper.github.io');
  assert.strictEqual(messages[0].data.type, 'meta');
  assert.strictEqual(messages[0].data.key, KEY);
  assert.deepStrictEqual(messages[0].data.data, record);

  const blocked = {
    location: { origin: 'https://juliangdeveloper.github.io' },
    parent: {
      postMessage: function () { throw new Error('bloqueado'); }
    }
  };
  assert.doesNotThrow(function () {
    const again = Meta.metaUpdate(SLUG, '1.12.0', { stats: { sessions: 2 }, logros: [] }, {
      localStorage: storage,
      now: WHEN,
      window: blocked
    });
    assert.strictEqual(again.stats.sessions, 2);
  });

  const broken = {
    getItem: function () { throw new Error('lectura'); },
    setItem: function () { throw new Error('cuota'); }
  };
  let failed = 'pending';
  assert.doesNotThrow(function () {
    failed = Meta.metaUpdate(SLUG, '1.12.0', { stats: { sessions: 1 }, logros: [] }, {
      localStorage: broken,
      now: WHEN,
      window: sameWindow()
    });
  });
  assert.strictEqual(failed, null);
});

test('como máximo hay 20 estadísticas numéricas', () => {
  const stats = {};
  for (let i = 0; i < 25; i++) stats['k_' + i] = i;
  const record = Meta.metaUpdate(SLUG, '1.12.0', { stats: stats, logros: [] }, {
    localStorage: memoryStorage(),
    now: WHEN,
    window: sameWindow()
  });
  assert.strictEqual(Object.keys(record.stats).length, 20);
  assert.strictEqual(record.stats.k_0, 0);
  assert.strictEqual(record.stats.k_19, 19);
  assert.strictEqual(record.stats.k_20, undefined);
});

test('los logros salen de umbrales fijos entre el primer uso y la constancia', () => {
  assert.strictEqual(Progress.SLUG, SLUG);
  assert.ok(Progress.ACHIEVEMENTS.length >= 5 && Progress.ACHIEVEMENTS.length <= 12);
  const cases = [
    ['first_note', 'notes_captured_total', 1],
    ['ten_notes', 'notes_captured_total', 10],
    ['hundred_notes', 'notes_captured_total', 100],
    ['five_hundred_notes', 'notes_captured_total', 500],
    ['thousand_notes', 'notes_captured_total', 1000],
    ['first_session', 'sessions', 1],
    ['ten_sessions', 'sessions', 10],
    ['fifty_sessions', 'sessions', 50],
    ['first_chord', 'chords_captured', 1],
    ['ten_chords', 'chords_captured', 10],
    ['long_phrase', 'longest_session_notes', 16],
    ['recital', 'longest_session_notes', 64]
  ];
  assert.deepStrictEqual(Progress.ACHIEVEMENTS.map(function (item) { return item.id; }), cases.map(function (row) {
    return row[0];
  }));
  assert.deepStrictEqual(Progress.logrosFor(Progress.emptyStats()), []);
  cases.forEach(function (row) {
    const below = Progress.emptyStats();
    below[row[1]] = row[2] - 1;
    assert.strictEqual(Progress.logrosFor(below).indexOf(row[0]) === -1, true, row[0] + ' debajo');
    const at = Progress.emptyStats();
    at[row[1]] = row[2];
    assert.strictEqual(Progress.logrosFor(at).indexOf(row[0]) >= 0, true, row[0] + ' en el umbral');
  });
});

test('una sesión cuenta acordes al entrar en dos notas y no repite la sesión abierta', () => {
  const storage = memoryStorage({ 'piano-transcribe.source': 'line' });
  let queued = null;
  const tracker = Progress.createTracker({
    version: '1.12.0',
    localStorage: storage,
    now: WHEN,
    clock: function () { return 0; },
    setTimer: function (fn) { queued = fn; return 1; },
    clearTimer: function () { queued = null; },
    window: sameWindow()
  });
  tracker.load();
  tracker.endSession();
  assert.strictEqual(tracker.stats().sessions, 0);
  tracker.beginSession();
  tracker.beginSession();
  tracker.captureNote(1);
  tracker.captureNote(1);
  tracker.captureNote(2);
  tracker.captureNote(2);
  tracker.captureNote(1);
  tracker.captureNote(2);
  tracker.endSession();
  const record = tracker.flush();
  assert.strictEqual(queued, null);
  assert.deepStrictEqual(record.stats, {
    sessions: 1,
    notes_captured_total: 6,
    longest_session_notes: 6,
    chords_captured: 2
  });
  assert.deepStrictEqual(record.logros, ['first_chord', 'first_note', 'first_session']);
  assert.strictEqual(record.hitos.first_chord, '2026-10-23T18:00:00.000Z');
  assert.strictEqual(storage.getItem('piano-transcribe.source'), 'line');
});

test('el guardado de progreso espera un segundo y escribe el último conteo', () => {
  const storage = memoryStorage();
  let now = 5000;
  const pending = [];
  const tracker = Progress.createTracker({
    version: '1.12.0',
    localStorage: storage,
    clock: function () { return now; },
    setTimer: function (fn, ms) {
      pending.push({ fn: fn, ms: ms });
      return pending.length;
    },
    clearTimer: function (id) {
      if (pending[id - 1]) pending[id - 1].cleared = true;
    },
    window: sameWindow()
  });
  tracker.load();
  const afterLoad = storage.getItem(KEY);
  tracker.beginSession();
  tracker.captureNote(1);
  tracker.captureNote(1);
  assert.strictEqual(pending.length, 1);
  assert.strictEqual(pending[0].ms, 1000);
  assert.strictEqual(storage.getItem(KEY), afterLoad);
  now = 6000;
  pending[0].fn();
  const record = JSON.parse(storage.getItem(KEY));
  assert.strictEqual(record.stats.sessions, 1);
  assert.strictEqual(record.stats.notes_captured_total, 2);
  assert.ok(record.logros.indexOf('first_note') >= 0);
  assert.ok(record.logros.indexOf('first_session') >= 0);
  now = 7000;
  tracker.captureNote(1);
  const immediate = JSON.parse(storage.getItem(KEY));
  assert.strictEqual(pending.length, 1);
  assert.strictEqual(immediate.stats.notes_captured_total, 3);
});
