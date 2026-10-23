// test/meta.test.js — meta.v1 y la migración del progreso de piano-transcribe.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const Meta = require('../js/meta.js');
const Progress = require('../js/progress.js');

const SLUG = 'piano-transcribe';
const KEY = 'meta.v1.piano-transcribe';
const CORRUPT = 'meta.v1.piano-transcribe.corrupt';
const WHEN = new Date('2026-10-23T18:00:00.000Z');
const VERSION = '1.12.3';

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
  const win = { location: { origin: 'https://juliangdeveloper.github.io', search: '' } };
  win.parent = win;
  win.postMessage = function () {
    throw new Error('no debería publicar en la propia ventana');
  };
  return win;
}

function envAt(storage, when, extra) {
  return Object.assign({
    localStorage: storage,
    now: when,
    window: sameWindow(),
    declared: Progress.STATS
  }, extra || {});
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
  const record = Meta.metaBackfill(SLUG, 'v' + VERSION, Progress.deriveLegacy, envAt(storage, WHEN));
  assert.deepStrictEqual(record, {
    v: 1,
    slug: SLUG,
    version: VERSION,
    updatedAt: '2026-10-23T18:00:00.000Z',
    stats: zeros(),
    logros: [],
    hitos: {},
    proyecto: Object.assign({}, Meta.PROYECTO)
  });
  assert.strictEqual(record.version.indexOf('v'), -1);
  assert.deepStrictEqual(JSON.parse(storage.getItem(KEY)), record);
  assert.strictEqual(storage.getItem('piano-transcribe.source'), 'midi');
  assert.strictEqual(storage.getItem('piano-game.source'), 'mic');
  assert.strictEqual(storage.getItem('piano-transcribe.engine'), '1.11.0');
  assert.strictEqual(storage.getItem(CORRUPT), null);
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
  const back = Meta.metaBackfill(SLUG, VERSION, Progress.deriveLegacy, envAt(storage, WHEN));
  assert.strictEqual(writes, 0);
  assert.strictEqual(back.updatedAt, '2026-01-01T00:00:00.000Z');
  assert.strictEqual(back.version, '1.11.0');
  assert.deepStrictEqual(back.stats, existing.stats);
  assert.deepStrictEqual(back.hitos, existing.hitos);
});

test('un registro corrupto se copia y se reconstruye sin tocar el resto', () => {
  const cases = [
    '{',
    'null',
    '[]',
    '42',
    JSON.stringify({ v: 2, slug: SLUG, stats: { sessions: 8 }, logros: [], hitos: {} }),
    JSON.stringify({ v: 1, slug: 'otro', stats: { sessions: 9 }, logros: [], hitos: {} })
  ];
  cases.forEach(function (raw, index) {
    const storage = memoryStorage({
      'piano-transcribe.source': 'midi',
      'piano-transcribe.engine': '1.11.0'
    });
    storage.setItem(KEY, raw);
    let record;
    assert.doesNotThrow(function () {
      record = Meta.metaBackfill(SLUG, VERSION, function () {
        if (index === 0) throw new Error('derive no debería impedir el registro');
        return Progress.deriveLegacy();
      }, envAt(storage, new Date(WHEN.getTime() + index * 1000)));
    });
    assert.strictEqual(storage.getItem(CORRUPT), raw);
    assert.strictEqual(record.v, 1);
    assert.strictEqual(record.slug, SLUG);
    assert.strictEqual(record.version, VERSION);
    if (index === 0) assert.deepStrictEqual(record.stats, {});
    else assert.deepStrictEqual(record.stats, zeros());
    assert.strictEqual(storage.getItem('piano-transcribe.source'), 'midi');
    assert.strictEqual(storage.getItem('piano-transcribe.engine'), '1.11.0');
    assert.doesNotThrow(function () { JSON.parse(storage.getItem(KEY)); });
  });
});

test('metaUpdate une logros, conserva hitos y descarta números no finitos', () => {
  const storage = memoryStorage();
  Meta.metaUpdate(SLUG, VERSION, {
    stats: { sessions: 1, notes_captured_total: 4, chords_captured: 0 },
    logros: ['first_note']
  }, envAt(storage, WHEN));
  const second = Meta.metaUpdate(SLUG, VERSION, {
    stats: {
      sessions: 2,
      notes_captured_total: NaN,
      longest_session_notes: Infinity,
      best_title: 'Do mayor'
    },
    logros: ['ten_notes', 'first_note', 'first_note']
  }, envAt(storage, new Date('2026-10-23T19:00:00.000Z')));
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

test('el tope y el orden salen de las claves declaradas', () => {
  assert.ok(Progress.STATS.length <= 20);
  assert.deepStrictEqual(Progress.STATS.map(function (item) { return item.key; }), [
    'sessions',
    'notes_captured_total',
    'longest_session_notes',
    'chords_captured'
  ]);
  assert.ok(Progress.STATS.every(function (item) { return item.monotonic === true; }));
  const declared = [];
  const stats = { extra_blob: 1 };
  const names = [];
  for (let i = 0; i < 25; i++) {
    declared.push({ key: 'k_' + i, monotonic: false });
    stats['k_' + i] = i;
    if (i < 20) names.push('k_' + i);
  }
  const storage = memoryStorage();
  const record = Meta.metaUpdate(SLUG, VERSION, { stats: stats, logros: [] }, envAt(storage, WHEN, {
    declared: declared
  }));
  assert.deepStrictEqual(Object.keys(record.stats), names);
  assert.strictEqual(record.stats.k_0, 0);
  assert.strictEqual(record.stats.k_19, 19);
  assert.strictEqual(record.stats.k_20, undefined);
  assert.strictEqual(record.stats.extra_blob, undefined);
});

test('las claves monotonicas no bajan y las demás se reemplazan', () => {
  const declared = Progress.STATS.concat([{ key: 'take', monotonic: false }]);
  const storage = memoryStorage();
  Meta.metaUpdate(SLUG, VERSION, {
    stats: {
      sessions: 4,
      notes_captured_total: 10,
      longest_session_notes: 8,
      chords_captured: 2,
      take: 5,
      extra: 9
    },
    logros: []
  }, envAt(storage, WHEN, { declared: declared }));
  const second = Meta.metaUpdate(SLUG, VERSION, {
    stats: { sessions: 1, notes_captured_total: NaN, take: 3, extra: 1 },
    logros: []
  }, envAt(storage, new Date(WHEN.getTime() + 1000), { declared: declared }));
  assert.deepStrictEqual(second.stats, {
    sessions: 4,
    notes_captured_total: 10,
    longest_session_notes: 8,
    chords_captured: 2,
    take: 3
  });
  assert.deepStrictEqual(Object.keys(second.stats), [
    'sessions',
    'notes_captured_total',
    'longest_session_notes',
    'chords_captured',
    'take'
  ]);
});

test('metaUpdate avisa al padre y no lanza si el almacenamiento falla', () => {
  const storage = memoryStorage();
  const messages = [];
  const win = {
    location: { origin: 'https://juliangdeveloper.github.io', search: '' },
    parent: {
      postMessage: function (data, origin) {
        messages.push({ data: data, origin: origin });
      }
    }
  };
  const record = Meta.metaUpdate(SLUG, VERSION, {
    stats: { sessions: 1 },
    logros: ['first_session']
  }, envAt(storage, WHEN, { window: win }));
  assert.strictEqual(messages.length, 1);
  assert.strictEqual(messages[0].origin, 'https://juliangdeveloper.github.io');
  assert.strictEqual(messages[0].data.type, 'meta');
  assert.strictEqual(messages[0].data.key, KEY);
  assert.deepStrictEqual(messages[0].data.data, record);

  const blocked = {
    location: { origin: 'https://juliangdeveloper.github.io', search: '' },
    parent: {
      postMessage: function () { throw new Error('bloqueado'); }
    }
  };
  assert.doesNotThrow(function () {
    const again = Meta.metaUpdate(SLUG, VERSION, { stats: { sessions: 2 }, logros: [] }, envAt(storage, new Date(WHEN.getTime() + 1000), {
      window: blocked
    }));
    assert.strictEqual(again.stats.sessions, 2);
  });

  const broken = {
    getItem: function () { throw new Error('lectura'); },
    setItem: function () { throw new Error('cuota'); }
  };
  let failed = 'pending';
  assert.doesNotThrow(function () {
    failed = Meta.metaUpdate(SLUG, VERSION, { stats: { sessions: 1 }, logros: [] }, envAt(broken, new Date(WHEN.getTime() + 5000)));
  });
  assert.strictEqual(failed, null);
});

test('el helper no escribe ni avisa dos veces en el mismo segundo', () => {
  const storage = memoryStorage();
  const posts = [];
  const win = {
    location: { origin: 'https://juliangdeveloper.github.io', search: '' },
    parent: { postMessage: function () { posts.push(1); } }
  };
  Meta.metaUpdate(SLUG, VERSION, { stats: { sessions: 1 }, logros: [] }, envAt(storage, WHEN, { window: win }));
  Meta.metaUpdate(SLUG, VERSION, { stats: { sessions: 5 }, logros: [] }, envAt(storage, new Date(WHEN.getTime() + 500), { window: win }));
  assert.strictEqual(JSON.parse(storage.getItem(KEY)).stats.sessions, 1);
  assert.strictEqual(posts.length, 1);
  const third = Meta.metaUpdate(SLUG, VERSION, { stats: { sessions: 5 }, logros: [] }, envAt(storage, new Date(WHEN.getTime() + 1000), { window: win }));
  assert.strictEqual(third.stats.sessions, 5);
  assert.strictEqual(posts.length, 2);
});

test('demo y preview no escriben ni avisan', () => {
  ['?demo=1', '?preview=1', '?x=1&demo=true'].forEach(function (search) {
    const posts = [];
    const backing = memoryStorage({ 'piano-transcribe.source': 'midi' });
    let sets = 0;
    const storage = {
      getItem: function (key) { return backing.getItem(key); },
      setItem: function (key, value) { sets += 1; backing.setItem(key, value); }
    };
    const win = {
      location: { origin: 'https://juliangdeveloper.github.io', search: search },
      parent: { postMessage: function () { posts.push(1); } }
    };
    const direct =     Meta.metaUpdate(SLUG, VERSION, { stats: { sessions: 3 }, logros: ['first_session'] }, {
      localStorage: storage,
      now: WHEN,
      declared: Progress.STATS,
      force: true,
      window: win
    });
    assert.strictEqual(direct, null);
    Meta.metaBackfill(SLUG, VERSION, Progress.deriveLegacy, {
      localStorage: storage,
      now: WHEN,
      declared: Progress.STATS,
      window: win
    });
    const tracker = Progress.createTracker({
      version: VERSION,
      localStorage: storage,
      window: win,
      clock: function () { return 0; },
      setTimer: function () { return 1; },
      clearTimer: function () {}
    });
    tracker.load();
    tracker.beginSession();
    tracker.captureNote(2);
    tracker.endSession();
    tracker.flush();
    assert.strictEqual(sets, 0);
    assert.strictEqual(posts.length, 0);
    assert.strictEqual(backing.getItem(KEY), null);
    assert.strictEqual(backing.getItem('piano-transcribe.source'), 'midi');
  });
});

test('los logros salen de umbrales fijos entre el primer uso y la constancia', () => {
  assert.strictEqual(Progress.SLUG, SLUG);
  assert.strictEqual(Meta.keyFor(SLUG), KEY);
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
  let now = 0;
  let queued = null;
  const tracker = Progress.createTracker({
    version: VERSION,
    localStorage: storage,
    now: WHEN,
    clock: function () { return now; },
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
  assert.strictEqual(tracker.flush(), null);
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
    version: VERSION,
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

test('en uso normal hay como máximo una escritura por segundo, contando el backfill', () => {
  let now = 10000;
  const keys = [];
  const backing = memoryStorage();
  const storage = {
    getItem: function (key) { return backing.getItem(key); },
    setItem: function (key, value) {
      keys.push(key);
      backing.setItem(key, value);
    }
  };
  const tracker = Progress.createTracker({
    version: VERSION,
    localStorage: storage,
    clock: function () { return now; },
    setTimer: function () { return 1; },
    clearTimer: function () {},
    window: sameWindow()
  });
  tracker.load();
  assert.deepStrictEqual(keys, [KEY]);
  tracker.flush();
  assert.deepStrictEqual(keys, [KEY]);
  tracker.beginSession();
  tracker.captureNote(1);
  now = 10500;
  tracker.captureNote(1);
  assert.deepStrictEqual(keys, [KEY]);
  now = 11000;
  tracker.captureNote(1);
  assert.deepStrictEqual(keys, [KEY, KEY]);
  assert.strictEqual(JSON.parse(backing.getItem(KEY)).stats.notes_captured_total, 3);
  assert.strictEqual(JSON.parse(backing.getItem(KEY)).stats.sessions, 1);
});

test('pagehide y ocultar la página guardan un cambio pendiente antes de un segundo', () => {
  let now = 20000;
  const keys = [];
  const posts = [];
  const backing = memoryStorage();
  const storage = {
    getItem: function (key) { return backing.getItem(key); },
    setItem: function (key, value) {
      keys.push(key);
      backing.setItem(key, value);
    }
  };
  const handlers = {};
  const target = {
    visibilityState: 'visible',
    addEventListener: function (type, fn) {
      handlers[type] = fn;
    },
    emit: function (type) {
      if (handlers[type]) handlers[type]();
    }
  };
  const win = {
    location: { origin: 'https://juliangdeveloper.github.io', search: '' },
    parent: { postMessage: function () { posts.push(1); } }
  };
  const tracker = Progress.createTracker({
    version: VERSION,
    localStorage: storage,
    clock: function () { return now; },
    setTimer: function () { return 1; },
    clearTimer: function () {},
    window: win
  });
  Progress.bindLifecycle(tracker, target, target);
  tracker.load();
  assert.deepStrictEqual(keys, [KEY]);
  assert.strictEqual(posts.length, 1);
  target.emit('pagehide');
  assert.deepStrictEqual(keys, [KEY]);
  tracker.beginSession();
  tracker.captureNote(1);
  now = 20400;
  assert.deepStrictEqual(keys, [KEY]);
  target.emit('pagehide');
  assert.deepStrictEqual(keys, [KEY, KEY]);
  assert.strictEqual(posts.length, 2);
  assert.strictEqual(JSON.parse(backing.getItem(KEY)).stats.notes_captured_total, 1);
  target.emit('pagehide');
  target.visibilityState = 'visible';
  target.emit('visibilitychange');
  assert.deepStrictEqual(keys, [KEY, KEY]);
  assert.strictEqual(posts.length, 2);
  tracker.captureNote(1);
  now = 20600;
  target.visibilityState = 'hidden';
  target.emit('visibilitychange');
  assert.deepStrictEqual(keys, [KEY, KEY, KEY]);
  assert.strictEqual(posts.length, 3);
  assert.strictEqual(JSON.parse(backing.getItem(KEY)).stats.notes_captured_total, 2);
  target.visibilityState = 'hidden';
  target.emit('visibilitychange');
  assert.deepStrictEqual(keys, [KEY, KEY, KEY]);
  assert.strictEqual(posts.length, 3);
});

test('tras cargar y tocar, las claves viejas siguen byte a byte', () => {
  const blob = 'data:image/png;base64,' + 'A'.repeat(4000);
  const backing = memoryStorage({
    'piano-transcribe.source': blob,
    'piano-game.source': 'mic',
    'piano-transcribe.engine': '1.11.0'
  });
  const written = [];
  const storage = {
    getItem: function (key) { return backing.getItem(key); },
    setItem: function (key, value) {
      written.push(key);
      backing.setItem(key, value);
    }
  };
  let now = 0;
  const tracker = Progress.createTracker({
    version: VERSION,
    localStorage: storage,
    clock: function () { return now; },
    setTimer: function () { return 1; },
    clearTimer: function () {},
    window: sameWindow()
  });
  tracker.load();
  tracker.beginSession();
  tracker.captureNote(1);
  tracker.captureNote(2);
  tracker.endSession();
  now = 1000;
  const record = tracker.flush();
  assert.strictEqual(backing.getItem('piano-transcribe.source'), blob);
  assert.strictEqual(backing.getItem('piano-game.source'), 'mic');
  assert.strictEqual(backing.getItem('piano-transcribe.engine'), '1.11.0');
  assert.ok(written.indexOf('piano-transcribe.source') === -1);
  assert.ok(written.indexOf('piano-game.source') === -1);
  assert.ok(written.indexOf('piano-transcribe.engine') === -1);
  assert.ok(written.every(function (key) { return key === KEY || key === CORRUPT; }));
  assert.ok(backing.getItem(KEY).indexOf('base64') === -1);
  assert.strictEqual(record.stats.notes_captured_total, 2);
  assert.strictEqual(record.stats.chords_captured, 1);
});
