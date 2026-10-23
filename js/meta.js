// js/meta.js — registro compartido meta.v1. Misma conducta en cada app.
// UMD: module.exports (Node) + window.Meta (navegador).
'use strict';

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Meta = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STAT_LIMIT = 20;
  var WRITE_MS = 1000;
  var writeClock = typeof WeakMap === 'function' ? new WeakMap() : null;

  // Project status, set by hand and bumped with the version. Never computed from play.
  // fase 1-6: Idea, Definición, Diseño, Construcción, Validación, Lanzamiento y mantenimiento.
  // fase_estado 0-4: pendiente, en curso, bloqueada, en revisión, completada.
  var PROYECTO = {
    objetivo: 'Ver en partitura, en vivo, lo que se toca en el piano por micrófono o MIDI, y servir ese motor de notas a otras apps.',
    fase: 6,
    fase_estado: 1,
    fases_completadas: 5
  };

  var proyectoSource = PROYECTO;

  function proyectoInt(n, lo, hi) {
    return typeof n === 'number' && Number.isInteger(n) && n >= lo && n <= hi;
  }

  // Clean copy of a proyecto block, or null when any field is missing or out of range.
  function metaProyecto(p) {
    try {
      if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
      var o = p.objetivo;
      if (typeof o !== 'string' || !o.trim() || Array.from(o).length > 140) return null;
      if (!proyectoInt(p.fase, 1, 6) || !proyectoInt(p.fase_estado, 0, 4) || !proyectoInt(p.fases_completadas, 0, 6)) return null;
      return { objetivo: o, fase: p.fase, fase_estado: p.fase_estado, fases_completadas: p.fases_completadas };
    } catch (e) {
      return null;
    }
  }

  // Tests only: swap the block the writer uses (null restores PROYECTO).
  function metaSetProyecto(p) {
    proyectoSource = p === null ? PROYECTO : p;
  }

  // Adds the current proyecto block to a record being written, when it is valid.
  function withProyecto(record) {
    var p = metaProyecto(proyectoSource);
    if (p) record.proyecto = p;
    return record;
  }

  function keyFor(slug) {
    return 'meta.v1.' + slug;
  }

  function corruptKey(slug) {
    return keyFor(slug) + '.corrupt';
  }

  function finiteNumber(value) {
    return typeof value === 'number' && isFinite(value);
  }

  function snakeId(value) {
    return typeof value === 'string' && /^[a-z0-9_]+$/.test(value);
  }

  function resolveStorage(env) {
    if (env && env.localStorage) return env.localStorage;
    if (typeof localStorage !== 'undefined') return localStorage;
    return null;
  }

  function resolveWindow(env) {
    if (env && env.window) return env.window;
    if (typeof window !== 'undefined') return window;
    return null;
  }

  function locationSearch(win) {
    try {
      if (win && win.location && typeof win.location.search === 'string') return win.location.search;
    } catch (e) {}
    return '';
  }

  function isDemo(env) {
    if (env && env.demo === true) return true;
    var search = locationSearch(resolveWindow(env));
    return /(?:^|[?&])demo=(?:1|true)(?:&|$)/.test(search)
      || /(?:^|[?&])preview=(?:1|true)(?:&|$)/.test(search);
  }

  function resolveNow(env) {
    if (env && env.now != null) return env.now;
    if (env && typeof env.nowMs === 'number' && isFinite(env.nowMs)) return new Date(env.nowMs);
    return new Date();
  }

  function rateMs(env) {
    if (env && typeof env.nowMs === 'number' && isFinite(env.nowMs)) return env.nowMs;
    var now = resolveNow(env);
    var date = now instanceof Date ? now : new Date(now);
    var ms = date.getTime();
    return isNaN(ms) ? Date.now() : ms;
  }

  function stampOf(now) {
    var date = now instanceof Date ? now : new Date(now);
    if (isNaN(date.getTime())) date = new Date();
    return date.toISOString();
  }

  function plainVersion(version) {
    var text = String(version == null ? '' : version).replace(/^\s+/, '');
    if (text.charAt(0) === 'v' || text.charAt(0) === 'V') text = text.slice(1);
    return text;
  }

  function tooSoon(storage, ms) {
    if (!writeClock || !storage) return false;
    var prev = writeClock.get(storage);
    return typeof prev === 'number' && ms - prev < WRITE_MS;
  }

  function markWritten(storage, ms) {
    if (writeClock && storage) writeClock.set(storage, ms);
  }

  function declaredList(patch, env) {
    var src = env && Array.isArray(env.declared)
      ? env.declared
      : (patch && Array.isArray(patch.declared) ? patch.declared : []);
    var out = [];
    var seen = {};
    var i;
    for (i = 0; i < src.length && out.length < STAT_LIMIT; i++) {
      var item = src[i];
      var key = typeof item === 'string' ? item : (item && item.key);
      if (!snakeId(key) || seen[key]) continue;
      seen[key] = true;
      out.push({
        key: key,
        monotonic: !!(item && typeof item === 'object' && item.monotonic)
      });
    }
    return out;
  }

  function mergeStats(prev, patch, declared) {
    var prevStats = prev && typeof prev === 'object' && !Array.isArray(prev) ? prev : {};
    var nextStats = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
    var out = {};
    var i;
    for (i = 0; i < declared.length; i++) {
      var key = declared[i].key;
      var hasNew = Object.prototype.hasOwnProperty.call(nextStats, key) && finiteNumber(nextStats[key]);
      var hasOld = Object.prototype.hasOwnProperty.call(prevStats, key) && finiteNumber(prevStats[key]);
      if (declared[i].monotonic) {
        if (hasNew && hasOld) out[key] = Math.max(prevStats[key], nextStats[key]);
        else if (hasNew) out[key] = nextStats[key];
        else if (hasOld) out[key] = prevStats[key];
      } else if (hasNew) {
        out[key] = nextStats[key];
      } else if (hasOld) {
        out[key] = prevStats[key];
      }
    }
    return out;
  }

  function isRecord(data, slug) {
    return !!data && typeof data === 'object' && !Array.isArray(data)
      && data.v === 1
      && data.slug === slug
      && data.stats && typeof data.stats === 'object' && !Array.isArray(data.stats)
      && Array.isArray(data.logros)
      && data.hitos && typeof data.hitos === 'object' && !Array.isArray(data.hitos);
  }

  function readRaw(storage, slug) {
    try {
      return storage.getItem(keyFor(slug));
    } catch (e) {
      return null;
    }
  }

  function classify(raw, slug) {
    if (raw == null || raw === '') return { state: 'missing' };
    try {
      var data = JSON.parse(raw);
      if (!data || typeof data !== 'object' || Array.isArray(data)) return { state: 'corrupt' };
      if (data.v !== 1 || data.slug !== slug) return { state: 'corrupt' };
      if (!isRecord(data, slug)) return { state: 'corrupt' };
      return { state: 'ok', record: data };
    } catch (e) {
      return { state: 'corrupt' };
    }
  }

  function quarantine(storage, slug, raw) {
    try {
      storage.setItem(corruptKey(slug), String(raw));
    } catch (e) {}
  }

  function unionLogros(prevLogros, prevHitos, incoming, nowIso) {
    var seen = {};
    var list = [];
    function add(id) {
      if (!snakeId(id) || seen[id]) return;
      seen[id] = true;
      list.push(id);
    }
    var i;
    if (Array.isArray(prevLogros)) {
      for (i = 0; i < prevLogros.length; i++) add(prevLogros[i]);
    }
    if (Array.isArray(incoming)) {
      for (i = 0; i < incoming.length; i++) add(incoming[i]);
    }
    list.sort();
    var hitos = {};
    for (i = 0; i < list.length; i++) {
      var id = list[i];
      var previous = prevHitos && typeof prevHitos[id] === 'string' && prevHitos[id]
        ? prevHitos[id]
        : '';
      hitos[id] = previous || nowIso;
    }
    return { logros: list, hitos: hitos };
  }

  function notifyParent(win, slug, record) {
    if (!win || win.parent === win || !win.parent) return;
    try {
      var origin = win.location && win.location.origin ? win.location.origin : '';
      win.parent.postMessage({ type: 'meta', key: keyFor(slug), data: record }, origin);
    } catch (e) {}
  }

  function metaUpdate(slug, version, patch, env) {
    try {
      if (isDemo(env)) return null;
      var storage = resolveStorage(env);
      if (!storage) return null;
      var ms = rateMs(env);
      if (!(env && env.force === true) && tooSoon(storage, ms)) {
        var cached = classify(readRaw(storage, slug), slug);
        return cached.state === 'ok' ? cached.record : null;
      }
      var raw = readRaw(storage, slug);
      var classified = classify(raw, slug);
      var prev = classified.state === 'ok' ? classified.record : null;
      if (classified.state === 'corrupt') quarantine(storage, slug, raw);
      var nowIso = stampOf(resolveNow(env));
      var achievements = unionLogros(
        prev ? prev.logros : [],
        prev ? prev.hitos : {},
        patch && patch.logros,
        nowIso
      );
      var record = {
        v: 1,
        slug: slug,
        version: plainVersion(version),
        updatedAt: nowIso,
        stats: mergeStats(prev ? prev.stats : {}, patch && patch.stats, declaredList(patch, env)),
        logros: achievements.logros,
        hitos: achievements.hitos
      };
      withProyecto(record);
      storage.setItem(keyFor(slug), JSON.stringify(record));
      markWritten(storage, ms);
      notifyParent(resolveWindow(env), slug, record);
      return record;
    } catch (e) {
      return null;
    }
  }

  function metaBackfill(slug, version, derive, env) {
    try {
      if (isDemo(env)) return null;
      var storage = resolveStorage(env);
      if (!storage) return null;
      var raw = readRaw(storage, slug);
      var classified = classify(raw, slug);
      if (classified.state === 'ok') return classified.record;
      var built = { stats: {}, logros: [] };
      try {
        var derived = typeof derive === 'function' ? derive(storage) : null;
        if (derived && typeof derived === 'object') {
          if (derived.stats && typeof derived.stats === 'object') built.stats = derived.stats;
          if (Array.isArray(derived.logros)) built.logros = derived.logros;
        }
      } catch (eDerive) {}
      return metaUpdate(slug, version, built, env);
    } catch (e) {
      return null;
    }
  }

  return {
    keyFor: keyFor,
    metaUpdate: metaUpdate,
    metaBackfill: metaBackfill,
    metaProyecto: metaProyecto,
    metaSetProyecto: metaSetProyecto,
    PROYECTO: PROYECTO
  };
});
