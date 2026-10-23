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

  function keyFor(slug) {
    return 'meta.v1.' + slug;
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

  function resolveNow(env) {
    if (env && env.now != null) return env.now;
    return new Date();
  }

  function stampOf(now) {
    var date = now instanceof Date ? now : new Date(now);
    if (isNaN(date.getTime())) date = new Date();
    return date.toISOString();
  }

  function cleanStats(stats) {
    var out = {};
    var count = 0;
    if (!stats || typeof stats !== 'object' || Array.isArray(stats)) return out;
    var keys = Object.keys(stats);
    var i;
    for (i = 0; i < keys.length && count < STAT_LIMIT; i++) {
      if (!snakeId(keys[i]) || !finiteNumber(stats[keys[i]])) continue;
      out[keys[i]] = stats[keys[i]];
      count += 1;
    }
    return out;
  }

  function mergeStats(prev, patch) {
    var merged = cleanStats(prev);
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return merged;
    var keys = Object.keys(patch);
    var i;
    for (i = 0; i < keys.length; i++) {
      if (!snakeId(keys[i]) || !finiteNumber(patch[keys[i]])) continue;
      merged[keys[i]] = patch[keys[i]];
    }
    return cleanStats(merged);
  }

  function isRecord(data, slug) {
    return !!data && typeof data === 'object'
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

  function readRecord(raw, slug) {
    if (raw == null || raw === '') return null;
    try {
      var data = JSON.parse(raw);
      if (!isRecord(data, slug)) return null;
      return data;
    } catch (e) {
      return null;
    }
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
      var storage = resolveStorage(env);
      if (!storage) return null;
      var nowIso = stampOf(resolveNow(env));
      var prev = readRecord(readRaw(storage, slug), slug);
      var achievements = unionLogros(
        prev ? prev.logros : [],
        prev ? prev.hitos : {},
        patch && patch.logros,
        nowIso
      );
      var record = {
        v: 1,
        slug: slug,
        version: String(version),
        updatedAt: nowIso,
        stats: mergeStats(prev ? prev.stats : {}, patch && patch.stats),
        logros: achievements.logros,
        hitos: achievements.hitos
      };
      storage.setItem(keyFor(slug), JSON.stringify(record));
      notifyParent(resolveWindow(env), slug, record);
      return record;
    } catch (e) {
      return null;
    }
  }

  function metaBackfill(slug, version, derive, env) {
    try {
      var storage = resolveStorage(env);
      if (!storage) return null;
      var raw = readRaw(storage, slug);
      if (raw != null && raw !== '') {
        var existing = readRecord(raw, slug);
        if (existing) return existing;
      }
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
    metaBackfill: metaBackfill
  };
});
