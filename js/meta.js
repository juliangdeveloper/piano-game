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

  var FASE = Object.freeze({ IDEA: 1, DEFINICION: 2, DISENO: 3, CONSTRUCCION: 4, VALIDACION: 5, LANZAMIENTO_Y_MANTENIMIENTO: 6, DESCARTADA: 7 });
  var ESTADO_FASE = Object.freeze({ PENDIENTE: 0, EN_CURSO: 1, BLOQUEADA: 2, EN_REVISION: 3, COMPLETADA: 4 });
  var TIPO_STAT = Object.freeze({ TOTAL_ACUMULADO: 'total_acumulado', MEJOR_MARCA: 'mejor_marca', VALOR_ACTUAL: 'valor_actual' });
  var TIPO_PROYECTO = Object.freeze({ PROYECTO: 'proyecto', AREA: 'area', RECURSO: 'recurso', ARCHIVO: 'archivo' });

  var PROYECTO = {
    objetivo: 'Motor de notas open source para mis apps y app web pública de transcripción de piano en vivo.',
    fase: FASE.DISENO,
    fase_estado: ESTADO_FASE.EN_CURSO,
    fases_completadas: 2
  };

  var proyectoSource = PROYECTO;

  function proyectoInt(n, lo, hi) {
    return typeof n === 'number' && Number.isInteger(n) && n >= lo && n <= hi;
  }

  function enumValido(enumeracion, valor) {
    return Object.values(enumeracion).indexOf(valor) !== -1;
  }

  function statConservaMaximo(tipo) {
    return tipo === TIPO_STAT.TOTAL_ACUMULADO || tipo === TIPO_STAT.MEJOR_MARCA;
  }

  function statsDeclarados(stats) {
    if (Array.isArray(stats)) return stats;
    if (!stats || typeof stats !== 'object') return [];
    return Object.keys(stats).map(function (key) { return { key: key, tipo: stats[key] && stats[key].tipo }; });
  }

  function metaProyecto(p) {
    try {
      if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
      var o = p.objetivo;
      if (typeof o !== 'string' || !o.trim() || Array.from(o).length > 140) return null;
      if (!enumValido(FASE, p.fase) || !enumValido(ESTADO_FASE, p.fase_estado) || !proyectoInt(p.fases_completadas, 0, FASE.LANZAMIENTO_Y_MANTENIMIENTO)) return null;
      if (p.tipo !== undefined && !enumValido(TIPO_PROYECTO, p.tipo)) return null;
      var bloque = { objetivo: o, fase: p.fase, fase_estado: p.fase_estado, fases_completadas: p.fases_completadas };
      if (p.tipo !== undefined) bloque.tipo = p.tipo;
      return bloque;
    } catch (e) {
      return null;
    }
  }

  function metaSetProyecto(p) {
    proyectoSource = p === null ? PROYECTO : p;
  }

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
    var src = statsDeclarados(env && env.declared ? env.declared : (patch && patch.declared));
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
        tipo: item && typeof item === 'object' ? item.tipo : undefined
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
      if (statConservaMaximo(declared[i].tipo)) {
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
    PROYECTO: PROYECTO,
    FASE: FASE,
    ESTADO_FASE: ESTADO_FASE,
    TIPO_STAT: TIPO_STAT,
    TIPO_PROYECTO: TIPO_PROYECTO,
    enumValido: enumValido,
    statConservaMaximo: statConservaMaximo,
    statsDeclarados: statsDeclarados
  };
});
