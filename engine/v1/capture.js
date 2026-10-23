// engine/v1/capture.js — motor de captura y partitura (interfaz 1).
// Sin DOM y sin dibujar el pentagrama. Un solo archivo: el cliente carga
// este módulo desde /engine/v1/capture.js?v=<versión>.
'use strict';

var A4_DEFAULT = 440;
var WINDOW_SIZE = 4096;
var MAX_LAG = 760;   // cubre C2 (~65.4 Hz) a 48 kHz
var TAU_MIN = 2;
var YIN_THRESHOLD = 0.15;
var NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function isValidBuffer(buffer) {
  return buffer && typeof buffer.length === 'number' &&
    buffer.length >= 2 * MAX_LAG;
}

// YIN: devuelve {freq, clarity} con freq=null si no hay tono fiable.
function detectPitch(buffer, sampleRate, opts) {
  opts = opts || {};
  var clarityThreshold = (typeof opts.clarityThreshold === 'number')
    ? opts.clarityThreshold : 0.90;

  if (!isValidBuffer(buffer) || !sampleRate || sampleRate <= 0) {
    return { freq: null, clarity: 0 };
  }

  var n = Math.min(buffer.length, WINDOW_SIZE);
  var maxLag = Math.min(MAX_LAG, Math.floor(n / 2));
  // Tope de lag: el rango de combate no busca C2. Sin tope se queda MAX_LAG.
  if (typeof opts.maxLag === 'number' && isFinite(opts.maxLag) && opts.maxLag > TAU_MIN) {
    maxLag = Math.min(maxLag, Math.floor(opts.maxLag));
  }

  // Señal sin energía (ceros, silencio) → sin tono
  var energy = 0;
  for (var e = 0; e < n; e++) energy += buffer[e] * buffer[e];
  if (energy < 1e-9) return { freq: null, clarity: 0 };

  // d(tau) — función de diferencia
  var d = new Float64Array(maxLag + 1);
  for (var tau = TAU_MIN; tau <= maxLag; tau++) {
    var sum = 0;
    for (var i = 0; i < n - tau; i++) {
      var diff = buffer[i] - buffer[i + tau];
      sum += diff * diff;
    }
    d[tau] = sum;
  }

  // d'(tau) — diferencia media normalizada acumulativa
  var dp = new Float64Array(maxLag + 1);
  dp[0] = 1;
  dp[1] = 1;
  var running = 0;
  var bestTau = -1;
  var bestDp = Infinity;

  for (var tau2 = TAU_MIN; tau2 <= maxLag; tau2++) {
    running += d[tau2];
    dp[tau2] = d[tau2] * (tau2 - TAU_MIN + 1) / (running || 1);
    if (dp[tau2] < YIN_THRESHOLD) {
      // primer valle por debajo del umbral → mejor τ local
      if (bestTau === -1 || dp[tau2] < bestDp) {
        bestTau = tau2;
        bestDp = dp[tau2];
      }
    } else if (bestTau !== -1) {
      break; // fin del primer valle
    }
  }

  // si no hubo valle bajo el umbral → argmin global
  if (bestTau === -1) {
    for (var tau3 = TAU_MIN; tau3 <= maxLag; tau3++) {
      if (dp[tau3] < bestDp) {
        bestDp = dp[tau3];
        bestTau = tau3;
      }
    }
  }

  if (bestTau < 0) return { freq: null, clarity: 0 };

  // Corrección de octava. Si el valle elegido es un múltiplo del periodo real
  // (subarmónico: la nota suena una octava abajo), baja a τ/k cuando ese valle
  // es casi igual de profundo. En graves del piano la fundamental es débil y
  // el argmin global caía en 2T (E3→E2, D4→D3).
  var k, sub, j, lo, hi, m, mv;
  for (k = 4; k >= 2; k--) {
    sub = bestTau / k;
    if (sub < TAU_MIN + 1) continue;
    lo = Math.max(TAU_MIN, Math.floor(sub) - 2);
    hi = Math.min(maxLag - 1, Math.ceil(sub) + 2);
    m = -1; mv = Infinity;
    for (j = lo; j <= hi; j++) if (dp[j] < mv) { mv = dp[j]; m = j; }
    if (m > TAU_MIN && dp[m] <= dp[m - 1] && dp[m] <= dp[m + 1] &&
        mv < Math.max(YIN_THRESHOLD * 2, bestDp * 1.6 + 0.06)) {
      bestTau = m; bestDp = mv;
      break;
    }
  }

  // Refinamiento parabólico con vecinos de d'(tau)
  var refinedTau = bestTau;
  var s0, s1, s2;
  if (bestTau > TAU_MIN && bestTau < maxLag) {
    s0 = dp[bestTau - 1];
    s1 = dp[bestTau];
    s2 = dp[bestTau + 1];
    var denom = 2 * (2 * s1 - s2 - s0);
    if (Math.abs(denom) > 1e-12) {
      var shift = (s2 - s0) / denom;
      if (Math.abs(shift) < 1) refinedTau = bestTau + shift;
    }
  }

  var clarity = 1 - dp[bestTau];
  if (clarity < 0) clarity = 0;
  if (clarity > 1) clarity = 1;

  // v1.3.1: el detector SIEMPRE reporta la freq encontrada — la decisión de
  // mostrarla es política del caller (umbral clarityThreshold). El threshold
  // sigue existiendo como datos (app.js lo usa), pero ya no borra la medición.
  return { freq: sampleRate / refinedTau, clarity: clarity };
}

// Convierte Hz → {name, octave, cents, midi}. No chequea rango C2–C7.
function noteFromFreq(freq, a4) {
  if (typeof freq !== 'number' || !isFinite(freq) || freq <= 0) return null;
  if (typeof a4 !== 'number' || !isFinite(a4) || a4 <= 0) a4 = A4_DEFAULT;

  var midiFloat = 69 + 12 * Math.log2(freq / a4);
  var midi = Math.round(midiFloat);
  var cents = Math.round((midiFloat - midi) * 100);
  // cents ∈ [-50, 50]
  if (cents > 50) { cents -= 100; midi += 1; }
  if (cents < -50) { cents += 100; midi -= 1; }

  var name = NAMES[((midi % 12) + 12) % 12];
  var octave = Math.floor(midi / 12) - 1;
  return { name: name, octave: octave, cents: cents, midi: midi };
}

// Frecuencia exacta de una nota (name ∈ NAMES, octava entera) dado A4.
function hzForNote(name, octave, a4) {
  if (typeof a4 !== 'number' || !isFinite(a4) || a4 <= 0) a4 = A4_DEFAULT;
  var idx = NAMES.indexOf(name);
  if (idx === -1) {
    throw new Error('Nombre de nota inválido: ' + name);
  }
  var midi = idx + (octave + 1) * 12;
  return a4 * Math.pow(2, (midi - 69) / 12);
}

// Número MIDI → {name, octave, cents:0, midi}. Fuera de 0–127 o no-entero → null.
function noteFromMidi(midi) {
  if (typeof midi !== 'number' || !isFinite(midi) || midi % 1 !== 0) return null;
  if (midi < 0 || midi > 127) return null;
  return {
    name: NAMES[midi % 12],
    octave: Math.floor(midi / 12) - 1,
    cents: 0,
    midi: midi
  };
}

/**
 * Umbral de claridad adaptativo: los agudos (C5+, midi ≥72) salen más débiles
 * del speaker del piano (rolloff físico) y su coherencia armónica real cae —
 * con umbral estricto 0.90 E5+ quedaba bajo el corte. Relajado a 0.78 arriba.
 */
function clarifyThresholdForMidi(midi, opts) {
  var strict = 0.90, relaxed = 0.78;
  if (opts && typeof opts.strict === 'number') strict = opts.strict;
  if (opts && typeof opts.relaxed === 'number') relaxed = opts.relaxed;
  return midi >= 72 ? relaxed : strict;
}

var INTERFACE = 1;
var VERSION = '1.10.0';
var HOP_MS = 20;

var MIN_RUN = 2;
var RELEASE_GAPS = 3;
var GATE_DB = -74;
var FLOOR_MARGIN_DB = 8;
var VOTE_N = 3;
var VOTE_MIN = 2;
var MIDI_8VB_BELOW = 48;
var CHORD_WINDOW_MS = 40;
var DEFAULT_BPM = 80;

var PROFILES = {
  combat: {
    minMidi: 48, maxMidi: 84, maxCents: 40,
    strict: 0.6, relaxed: 0.6, gateDb: GATE_DB, maxLagMode: 'combat'
  },
  score: {
    minMidi: 36, maxMidi: 96, maxCents: 40,
    strict: 0.6, relaxed: 0.6, gateDb: GATE_DB, maxLagMode: 'full'
  }
};

var DURATION_TABLE = [
  { type: 'w', beats: 4, sixteenths: 16 },
  { type: 'h', beats: 2, sixteenths: 8 },
  { type: 'q', beats: 1, sixteenths: 4 },
  { type: '8', beats: 0.5, sixteenths: 2 },
  { type: '16', beats: 0.25, sixteenths: 1 }
];

function blankVoice() {
  return { midi: null, name: null, run: 0, gap: 0, candMidi: null, candName: null };
}

function createMicState() {
  return {
    heldMidi: null,
    heldName: null,
    candMidi: null,
    candName: null,
    run: 0,
    gap: 0,
    votes: [],
    lastDb: -120,
    floorDb: null,
    octRun: 0,
    octMidi: null,
    slots: [blankVoice(), blankVoice()]
  };
}

function resetMicState(st) {
  if (!st) return;
  st.heldMidi = null;
  st.heldName = null;
  st.candMidi = null;
  st.candName = null;
  st.run = 0;
  st.gap = 0;
  st.votes = [];
  st.lastDb = -120;
  st.floorDb = null;
  st.octRun = 0;
  st.octMidi = null;
  st.slots = [blankVoice(), blankVoice()];
}

function rmsDb(buffer) {
  if (!buffer || !buffer.length) return -120;
  var sum = 0;
  var i;
  for (i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
  var rms = Math.sqrt(sum / buffer.length);
  return 20 * Math.log10(rms + 1e-12);
}

function acceptNote(note, clarity, opts) {
  opts = opts || {};
  var minMidi = opts.minMidi == null ? 48 : opts.minMidi;
  var maxMidi = opts.maxMidi == null ? 84 : opts.maxMidi;
  var maxCents = opts.maxCents == null ? 40 : opts.maxCents;
  var strict = opts.strict == null ? 0.6 : opts.strict;
  var relaxed = opts.relaxed == null ? 0.6 : opts.relaxed;
  if (!note || typeof note.midi !== 'number') return null;
  if (note.midi < minMidi || note.midi > maxMidi) return null;
  if (typeof note.cents === 'number' && Math.abs(note.cents) > maxCents) return null;
  var th = note.midi >= 72 ? relaxed : strict;
  if (typeof clarity === 'number' && clarity < th) return null;
  if (!note.note && note.name) note = { midi: note.midi, note: note.name, octave: note.octave, cents: note.cents };
  if (!note.note || typeof note.octave !== 'number') return null;
  return note.note + note.octave;
}

function isBlocked(blocks, midi, now) {
  if (!blocks || midi == null || typeof now !== 'number') return false;
  var i;
  for (i = 0; i < blocks.length; i++) {
    var b = blocks[i];
    if (!b || now >= b.until) continue;
    var d = midi - b.midi;
    if (d < 0) d = -d;
    if (d === 0 || d === 1 || d === 12) return true;
  }
  return false;
}

function observeMic(st, buf, sampleRate, cfg) {
  var db = rmsDb(buf);
  var onset = db - st.lastDb >= 6;
  st.lastDb = db;
  var reading = {
    db: db, freq: null, clarity: 0, midi: null, note: null,
    octave: null, pitch: null, cents: null, accepted: false
  };
  var res = null;
  var maxLag = cfg.maxLagMode === 'combat' ? Math.ceil(sampleRate / 120) : MAX_LAG;
  if (db >= cfg.gateDb && buf && buf.length) {
    res = detectPitch(buf, sampleRate, { maxLag: maxLag });
  }
  var tonal = !!(res && res.freq && res.clarity >= 0.6);
  var noisy = !res || !res.freq || res.clarity < 0.35;
  if (noisy) {
    if (st.floorDb == null || db < st.floorDb) st.floorDb = Math.min(db, -50);
    else if (st.floorDb < -50) st.floorDb += 0.03;
  }
  var floorOk = st.floorDb == null || db >= st.floorDb + FLOOR_MARGIN_DB;
  var raw = null;
  var rawPitch = null;
  var heard = null;
  if (res && res.freq) {
    reading.freq = res.freq;
    reading.clarity = res.clarity;
    heard = noteFromFreq(res.freq, cfg.a4);
    if (heard) {
      reading.midi = heard.midi;
      reading.note = heard.name;
      reading.octave = heard.octave;
      reading.pitch = heard.name + heard.octave;
      reading.cents = heard.cents;
    }
  }
  if (tonal && floorOk && heard) {
    var spelled = { midi: heard.midi, note: heard.name, octave: heard.octave, cents: heard.cents };
    var nm = acceptNote(spelled, res.clarity, cfg);
    if (nm) {
      raw = heard.midi;
      rawPitch = nm;
      reading.accepted = true;
    }
  }
  if (onset) st.votes = [];
  st.votes.push(raw == null ? null : { midi: raw, pitch: rawPitch, cents: heard ? heard.cents : 0, clarity: res ? res.clarity : 0 });
  if (st.votes.length > VOTE_N) st.votes.shift();
  var count = {};
  var best = null;
  var bestN = 0;
  var i;
  var v;
  for (i = 0; i < st.votes.length; i++) {
    v = st.votes[i];
    if (!v) continue;
    count[v.midi] = (count[v.midi] || 0) + 1;
    if (count[v.midi] > bestN) { bestN = count[v.midi]; best = v; }
  }
  var need = Math.min(VOTE_MIN, Math.max(2, st.votes.length));
  if (!best || bestN < need) {
    if (st.heldMidi != null && raw != null && count[st.heldMidi]) {
      return { midi: st.heldMidi, pitch: st.heldName, db: db, reading: reading };
    }
    return { midi: null, pitch: null, db: db, reading: reading };
  }
  if (st.heldMidi != null && best.midi !== st.heldMidi &&
      Math.abs(best.midi - st.heldMidi) % 12 === 0 && !onset) {
    st.octRun = (st.octMidi === best.midi) ? (st.octRun || 0) + 1 : 1;
    st.octMidi = best.midi;
    if (st.octRun < 15) return { midi: st.heldMidi, pitch: st.heldName, db: db, reading: reading };
  } else {
    st.octRun = 0;
    st.octMidi = null;
  }
  reading.accepted = true;
  reading.midi = best.midi;
  reading.pitch = best.pitch;
  var spelledBest = parsePitch(best.pitch);
  if (spelledBest) {
    reading.note = spelledBest.note;
    reading.octave = spelledBest.octave;
    reading.cents = best.cents;
  }
  return { midi: best.midi, pitch: best.pitch, cents: best.cents, clarity: best.clarity, db: db, reading: reading };
}

function hopMachine(st, obs) {
  var on = null;
  var off = null;
  obs = obs || {};
  var midi = obs.midi;
  var pitch = obs.pitch;
  if (midi == null || !pitch) {
    st.candMidi = null;
    st.candName = null;
    st.run = 0;
    st.gap += 1;
    if (st.heldMidi != null && st.gap >= RELEASE_GAPS) {
      off = st.heldName;
      st.heldMidi = null;
      st.heldName = null;
      st.gap = 0;
    }
    return { on: on, off: off };
  }
  st.gap = 0;
  if (st.heldMidi === midi) {
    st.candMidi = null;
    st.candName = null;
    st.run = 0;
    return { on: null, off: null };
  }
  if (st.candMidi === midi) st.run += 1;
  else {
    st.candMidi = midi;
    st.candName = pitch;
    st.run = 1;
  }
  if (st.run >= MIN_RUN) {
    if (st.heldName) off = st.heldName;
    st.heldMidi = midi;
    st.heldName = pitch;
    on = pitch;
    st.candMidi = null;
    st.candName = null;
    st.run = 0;
  }
  return { on: on, off: off };
}

function mergePress(heldMap, pitch, source) {
  var slot = heldMap[pitch];
  var fresh = !slot;
  if (!slot) {
    slot = {};
    heldMap[pitch] = slot;
  }
  var added = !slot[source];
  slot[source] = true;
  return {
    fresh: fresh,
    added: added,
    sound: added && source !== 'mic',
    combat: fresh
  };
}

function mergeRelease(heldMap, pitch, source) {
  var slot = heldMap[pitch];
  if (!slot) return { released: false };
  if (source) delete slot[source];
  else {
    delete heldMap[pitch];
    return { released: true };
  }
  var left = 0;
  var k;
  for (k in slot) {
    if (Object.prototype.hasOwnProperty.call(slot, k)) left += 1;
  }
  if (left) return { released: false };
  delete heldMap[pitch];
  return { released: true };
}

function parsePitch(pitch) {
  if (typeof pitch === 'number' && isFinite(pitch)) {
    var n = noteFromMidi(Math.round(pitch));
    if (!n) return null;
    return { midi: n.midi, note: n.name, octave: n.octave, pitch: n.name + n.octave, cents: n.cents };
  }
  if (typeof pitch !== 'string') return null;
  var m = /^([A-G]#?)(-?\d+)$/.exec(pitch);
  if (!m) return null;
  var idx = NAMES.indexOf(m[1]);
  if (idx < 0) return null;
  var oct = parseInt(m[2], 10);
  var midi = idx + (oct + 1) * 12;
  if (midi < 0 || midi > 127) return null;
  return { midi: midi, note: m[1], octave: oct, pitch: m[1] + oct, cents: 0 };
}

function quarterMs(bpm) { return 60000 / bpm; }

function parseTimeSig(str) {
  var parts = String(str || '4/4').split('/');
  var num = parseInt(parts[0], 10);
  var den = parseInt(parts[1], 10);
  if (!num || num < 1) num = 4;
  if (!den || den < 1) den = 4;
  return { num: num, den: den, str: num + '/' + den };
}

function measureSixteenths(ts) {
  return Math.round(ts.num * (16 / ts.den));
}

function lookupType(sixteenths) {
  var i;
  for (i = 0; i < DURATION_TABLE.length; i++) {
    if (DURATION_TABLE[i].sixteenths === sixteenths) return DURATION_TABLE[i].type;
  }
  return '16';
}

function quantizeDuration(durationMs, bpm) {
  var qMs = quarterMs(bpm > 0 ? bpm : DEFAULT_BPM);
  var ms = (typeof durationMs === 'number' && isFinite(durationMs)) ? durationMs : 0;
  if (ms < 0) ms = 0;
  var beats = ms / qMs;
  var best = DURATION_TABLE[DURATION_TABLE.length - 1];
  var bestDiff = Infinity;
  var i;
  for (i = 0; i < DURATION_TABLE.length; i++) {
    var d = Math.abs(beats - DURATION_TABLE[i].beats);
    if (d < bestDiff || (d === bestDiff && DURATION_TABLE[i].beats < best.beats)) {
      bestDiff = d;
      best = DURATION_TABLE[i];
    }
  }
  return { type: best.type, beats: best.beats, sixteenths: best.sixteenths };
}

function groupChords(events) {
  var sorted = events.slice().sort(function (a, b) {
    var dt = a.tStartMs - b.tStartMs;
    if (dt !== 0) return dt;
    return a.midi - b.midi;
  });
  var groups = [];
  var i;
  for (i = 0; i < sorted.length; i++) {
    var ev = sorted[i];
    var last = groups.length ? groups[groups.length - 1] : null;
    if (last && Math.abs(ev.tStartMs - last.tStartMs) <= CHORD_WINDOW_MS) {
      last.events.push(ev);
      last.tEndMs = Math.max(last.tEndMs, ev.tEndMs);
    } else {
      groups.push({ tStartMs: ev.tStartMs, tEndMs: ev.tEndMs, events: [ev] });
    }
  }
  return groups;
}

function greedySixteenths(n) {
  var parts = [];
  var vals = [16, 8, 4, 2, 1];
  var left = n;
  var i;
  for (i = 0; i < vals.length; i++) {
    while (left >= vals[i]) {
      parts.push(vals[i]);
      left -= vals[i];
    }
  }
  return parts;
}

// Dedo 1–5 (pulgar = 1). hand 'L' espeja la derecha. Un finger 1–5 ya
// presente en la nota se conserva; si no, se sugiere.
var FINGER_OFFSET = [0, 2, 4, 5, 7];

function readFinger(value) {
  if (typeof value !== 'number' || !isFinite(value)) return null;
  var n = Math.round(value);
  if (n < 1 || n > 5) return null;
  return n;
}

function handCode(opts) {
  var h = opts && opts.hand != null ? String(opts.hand).toLowerCase() : 'r';
  if (h === 'l' || h === 'left' || h === 'lh') return 'L';
  return 'R';
}

function fingerIdeal(a, b) {
  return FINGER_OFFSET[b - 1] - FINGER_OFFSET[a - 1];
}

function fingerMax(a, b) {
  var d = b - a;
  var table = [0, 5, 9, 12, 14];
  return table[d] != null ? table[d] : 14;
}

function fingerBlack(midi) {
  var pc = ((midi % 12) + 12) % 12;
  return pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10;
}

function fingerTransition(prevCoord, prevFinger, coord, finger) {
  var d = coord - prevCoord;
  var dist;
  var asc;
  var lo;
  var hi;
  var ideal;
  var diff;
  var cost;
  var base;
  if (d === 0) return finger === prevFinger ? 0 : 3;
  asc = d > 0;
  dist = asc ? d : -d;
  if (asc ? (finger > prevFinger) : (finger < prevFinger)) {
    lo = finger < prevFinger ? finger : prevFinger;
    hi = finger > prevFinger ? finger : prevFinger;
    if (dist <= fingerMax(lo, hi) && dist >= 1) {
      ideal = fingerIdeal(lo, hi);
      diff = dist > ideal ? dist - ideal : ideal - dist;
      cost = diff <= 1 ? diff * 0.15 : (0.15 + (diff - 1) * 1.05);
      if (dist > ideal + 3) cost += (dist - ideal - 3) * 0.8;
      return cost;
    }
  }
  if (asc && finger === 1 && prevFinger >= 2 && prevFinger <= 4 && dist >= 1 && dist <= 6) {
    base = prevFinger === 3 ? 2.2 : (prevFinger === 4 ? 3.3 : 4.6);
    return base + Math.abs(dist - 2) * 0.4;
  }
  if (!asc && prevFinger === 1 && finger >= 2 && finger <= 4 && dist >= 1 && dist <= 6) {
    base = finger === 3 ? 2.2 : (finger === 4 ? 3.3 : 4.6);
    return base + Math.abs(dist - 2) * 0.4;
  }
  return 6 + dist * 0.35;
}

function fingerLocal(coords, fingers, midis) {
  var cost = 0;
  var i;
  var span;
  var lo;
  var hi;
  for (i = 0; i < fingers.length; i++) {
    if (fingers[i] === 1 && fingerBlack(midis[i])) cost += 3.5;
    else if (fingers[i] === 5 && fingerBlack(midis[i])) cost += 0.6;
  }
  for (i = 1; i < fingers.length; i++) {
    span = coords[i] - coords[i - 1];
    lo = fingers[i - 1];
    hi = fingers[i];
    if (hi <= lo || span < 1) return 1e6;
    if (span > fingerMax(lo, hi)) {
      if (lo === 1 && hi === 5 && fingers.length === 2) cost += 8 + (span - fingerMax(1, 5));
      else return 1e6;
    } else {
      cost += Math.abs(span - fingerIdeal(lo, hi)) * 1.15;
    }
  }
  return cost;
}

function fingerCandidates(locks) {
  var n = locks.length;
  var out = [];
  var forced = false;
  function okLock(fs) {
    var i;
    for (i = 0; i < n; i++) if (locks[i] != null && locks[i] !== fs[i]) return false;
    return true;
  }
  function rec(start, left, acc) {
    var f;
    if (left === 0) {
      if (okLock(acc)) out.push(acc.slice());
      return;
    }
    for (f = start; f <= 5 - left + 1; f++) {
      acc.push(f);
      rec(f + 1, left - 1, acc);
      acc.pop();
    }
  }
  if (n >= 1 && n <= 5) rec(1, n, []);
  if (!out.length) {
    var fs = [];
    var used = {};
    var prefer = n === 2 ? [1, 5] : (n === 3 ? [1, 3, 5] : (n === 4 ? [1, 2, 4, 5] : [1, 2, 3, 4, 5]));
    var i;
    var pi = 0;
    var pick;
    var f;
    for (i = 0; i < n; i++) if (locks[i] != null) used[locks[i]] = true;
    for (i = 0; i < n; i++) {
      if (locks[i] != null) {
        fs.push(locks[i]);
        continue;
      }
      pick = null;
      while (pi < prefer.length) {
        if (!used[prefer[pi]]) { pick = prefer[pi]; pi++; break; }
        pi++;
      }
      if (pick == null) {
        for (f = 1; f <= 5; f++) if (!used[f]) { pick = f; break; }
      }
      if (pick == null) pick = 1;
      used[pick] = true;
      fs.push(pick);
    }
    out.push(fs);
    forced = true;
  }
  return { list: out, forced: forced };
}

function spellFinger(midi, finger) {
  var n = noteFromMidi(midi);
  if (!n) return null;
  return { midi: n.midi, pitch: n.name + n.octave, note: n.name, octave: n.octave, finger: finger };
}

function buildFingerStep(item, sign) {
  var raw = [];
  function add(midiValue, lock) {
    var parsed = null;
    if (midiValue && typeof midiValue === 'object') {
      if (lock == null) lock = midiValue.finger;
      if (typeof midiValue.midi === 'number') parsed = parsePitch(midiValue.midi);
      else if (typeof midiValue.pitch === 'string') parsed = parsePitch(midiValue.pitch);
      else if (typeof midiValue.note === 'string' && typeof midiValue.octave === 'number') {
        parsed = parsePitch(midiValue.note + midiValue.octave);
      }
    } else {
      parsed = parsePitch(midiValue);
    }
    if (!parsed) return;
    raw.push({ midi: parsed.midi, coord: sign * parsed.midi, lock: readFinger(lock) });
  }
  var arr = null;
  var locks = [];
  var i;
  if (Array.isArray(item)) arr = item;
  else if (item && typeof item === 'object' && (Array.isArray(item.midis) || Array.isArray(item.notes) || Array.isArray(item.pitches))) {
    arr = item.midis || item.notes || item.pitches;
    locks = Array.isArray(item.fingers) ? item.fingers : [];
  }
  if (arr) {
    for (i = 0; i < arr.length; i++) add(arr[i], locks[i]);
  } else {
    add(item, item && typeof item === 'object' ? item.finger : null);
  }
  raw.sort(function (a, b) { return a.coord - b.coord || a.midi - b.midi; });
  var parts = [];
  for (i = 0; i < raw.length && parts.length < 5; i++) {
    if (parts.length && parts[parts.length - 1].midi === raw[i].midi) {
      if (parts[parts.length - 1].lock == null) parts[parts.length - 1].lock = raw[i].lock;
      continue;
    }
    parts.push(raw[i]);
  }
  return parts;
}

function emptyFingering() {
  return { finger: null, midi: null, pitch: null, note: null, octave: null, notes: [] };
}

function solveFingers(steps) {
  var dp = [];
  var i;
  var c;
  var p;
  for (i = 0; i < steps.length; i++) {
    var parts = steps[i];
    var coords = [];
    var midis = [];
    var locks = [];
    var k;
    for (k = 0; k < parts.length; k++) {
      coords.push(parts[k].coord);
      midis.push(parts[k].midi);
      locks.push(parts[k].lock);
    }
    var cand = fingerCandidates(locks);
    dp[i] = [];
    for (c = 0; c < cand.list.length; c++) {
      var fs = cand.list[c];
      var loc = (cand.forced && c === cand.list.length - 1 && cand.list.length === 1) ? 0 : fingerLocal(coords, fs, midis);
      if (loc >= 1e6) continue;
      var best = null;
      var bestP = -1;
      if (i === 0) best = loc + (fs[0] - 1) * 0.2;
      else {
        for (p = 0; p < dp[i - 1].length; p++) {
          var prev = dp[i - 1][p];
          var add = 0;
          var a;
          var b;
          for (a = 0; a < fs.length; a++) {
            var link = 1e9;
            for (b = 0; b < prev.fs.length; b++) {
              var tcost = fingerTransition(prev.coords[b], prev.fs[b], coords[a], fs[a]);
              if (tcost < link) link = tcost;
            }
            add += link;
          }
          var tot = prev.cost + loc + add;
          if (best == null || tot < best) { best = tot; bestP = p; }
        }
      }
      if (best != null) dp[i].push({ fs: fs, coords: coords, midis: midis, cost: best, prev: bestP });
    }
    if (!dp[i].length) {
      var spread = fingerCandidates(locks).list[0];
      dp[i].push({
        fs: spread,
        coords: coords,
        midis: midis,
        cost: (i && dp[i - 1].length ? dp[i - 1][0].cost : 0) + 30,
        prev: i && dp[i - 1].length ? 0 : -1
      });
    }
  }
  var last = dp[steps.length - 1];
  var bi = 0;
  for (i = 1; i < last.length; i++) if (last[i].cost < last[bi].cost) bi = i;
  var picked = [];
  for (i = steps.length - 1; i >= 0; i--) {
    picked[i] = last[bi];
    bi = last[bi].prev;
    last = i ? dp[i - 1] : null;
  }
  var results = [];
  for (i = 0; i < picked.length; i++) {
    var pairs = [];
    for (k = 0; k < picked[i].midis.length; k++) {
      var sp = spellFinger(picked[i].midis[k], picked[i].fs[k]);
      if (sp) pairs.push(sp);
    }
    pairs.sort(function (a, b) { return a.midi - b.midi; });
    var top = pairs.length ? pairs[0] : null;
    results.push({
      finger: top ? top.finger : null,
      midi: top ? top.midi : null,
      pitch: top ? top.pitch : null,
      note: top ? top.note : null,
      octave: top ? top.octave : null,
      notes: pairs
    });
  }
  return results;
}

function suggestFingering(notes, opts) {
  if (!Array.isArray(notes)) return [];
  var sign = handCode(opts) === 'L' ? -1 : 1;
  var built = [];
  var index = [];
  var i;
  for (i = 0; i < notes.length; i++) {
    var parts = buildFingerStep(notes[i], sign);
    if (!parts.length) continue;
    index.push(i);
    built.push(parts);
  }
  var solved = built.length ? solveFingers(built) : [];
  var out = [];
  for (i = 0; i < notes.length; i++) out.push(emptyFingering());
  for (i = 0; i < index.length; i++) out[index[i]] = solved[i];
  return out;
}

function applyFingering(measures) {
  var hands = { R: [], L: [] };
  var mi;
  var ni;
  var k;
  for (mi = 0; mi < measures.length; mi++) {
    var notes = measures[mi].notes || [];
    for (ni = 0; ni < notes.length; ni++) {
      var note = notes[ni];
      if (!note || note.rest || !note.midis || !note.midis.length) continue;
      var buckets = { R: [], L: [] };
      for (k = 0; k < note.midis.length; k++) {
        var hand = note.midis[k] >= 60 ? 'R' : 'L';
        var lock = note.givenFingers && typeof note.givenFingers[k] === 'number' ? note.givenFingers[k] : null;
        buckets[hand].push({ midi: note.midis[k], index: k, lock: lock });
      }
      note.fingers = [];
      for (k = 0; k < note.midis.length; k++) note.fingers.push(null);
      if (buckets.R.length) hands.R.push({ note: note, slots: buckets.R });
      if (buckets.L.length) hands.L.push({ note: note, slots: buckets.L });
    }
  }
  function writeHand(hand, list) {
    if (!list.length) return;
    var input = [];
    var i;
    var j;
    for (i = 0; i < list.length; i++) {
      input.push({
        midis: list[i].slots.map(function (s) { return s.midi; }),
        fingers: list[i].slots.map(function (s) { return s.lock; })
      });
    }
    var got = suggestFingering(input, { hand: hand });
    for (i = 0; i < list.length; i++) {
      var row = got[i] && got[i].notes ? got[i].notes : [];
      for (j = 0; j < list[i].slots.length; j++) {
        var slot = list[i].slots[j];
        var finger = null;
        var g;
        for (g = 0; g < row.length; g++) if (row[g].midi === slot.midi) finger = row[g].finger;
        if (slot.lock != null) finger = slot.lock;
        list[i].note.fingers[slot.index] = finger;
        if (list[i].note.voices && list[i].note.voices[slot.index]) {
          list[i].note.voices[slot.index].finger = finger;
        }
      }
      list[i].note.finger = list[i].note.fingers.length ? list[i].note.fingers[0] : null;
    }
  }
  writeHand('R', hands.R);
  writeHand('L', hands.L);
  for (mi = 0; mi < measures.length; mi++) {
    var src = measures[mi].notes || [];
    for (ni = 0; ni < src.length; ni++) {
      if (src[ni]) delete src[ni].givenFingers;
    }
  }
}

function eventsToScore(events, opts) {
  opts = opts || {};
  var bpm = (typeof opts.bpm === 'number' && opts.bpm > 0) ? opts.bpm : DEFAULT_BPM;
  var ts = parseTimeSig(opts.timeSig || '4/4');
  var clef = opts.clef || 'treble';
  var cap = measureSixteenths(ts);
  var list = Array.isArray(events) ? events.filter(function (e) {
    return e && typeof e.midi === 'number' && typeof e.tStartMs === 'number';
  }) : [];
  var items = [];
  if (list.length && staggeredOverlap(list)) {
    items = sliceItems(list, bpm);
  } else if (list.length) {
    var groups = groupChords(list);
    var qMs = quarterMs(bpm);
    var restIgnore = qMs / 8;
    var cursor = groups[0].tStartMs;
    var g;
    for (g = 0; g < groups.length; g++) {
      var group = groups[g];
      var gap = group.tStartMs - cursor;
      if (gap >= restIgnore) items.push(restItem(quantizeDuration(gap, bpm)));
      var durMs = (typeof group.tEndMs === 'number' ? group.tEndMs : group.tStartMs) - group.tStartMs;
      if (durMs < 0) durMs = 0;
      items.push(noteItem(group, quantizeDuration(durMs, bpm)));
      cursor = group.tStartMs + Math.max(durMs, 0);
    }
  }
  var measures = packMeasures(items, cap);
  var mi;
  for (mi = 0; mi < measures.length; mi++) {
    var beat = 0;
    var notes = measures[mi].notes;
    var ni;
    for (ni = 0; ni < notes.length; ni++) {
      notes[ni].beat = beat;
      notes[ni].measure = mi;
      beat += (notes[ni].sixteenths || 0) / 4;
    }
    measures[mi].index = mi;
  }
  applyFingering(measures);
  return { bpm: bpm, timeSig: ts, timeSigStr: ts.str, clef: clef, measures: measures };
}

function noteItem(group, q) {
  var midis = [];
  var pitches = [];
  var notes = [];
  var octaves = [];
  var accidentals = [];
  var ottava = null;
  var givenFingers = [];
  var anyGiven = false;
  var i;
  for (i = 0; i < group.events.length; i++) {
    var sp = parsePitch(group.events[i].midi);
    if (!sp) continue;
    midis.push(sp.midi);
    pitches.push(sp.pitch);
    notes.push(sp.note);
    octaves.push(sp.octave);
    accidentals.push(sp.note.charAt(1) === '#' ? '#' : null);
    if (sp.midi < MIDI_8VB_BELOW) ottava = '8vb';
    var gf = readFinger(group.events[i].finger);
    givenFingers.push(gf);
    if (gf != null) anyGiven = true;
  }
  var voices = [];
  for (i = 0; i < midis.length; i++) {
    voices.push({ pitch: pitches[i], note: notes[i], octave: octaves[i], midi: midis[i], finger: null });
  }
  var row = {
    rest: false,
    duration: q.type,
    beats: q.beats,
    sixteenths: q.sixteenths,
    midi: midis.length ? midis[0] : null,
    midis: midis,
    pitch: pitches.length ? pitches[0] : null,
    pitches: pitches,
    note: notes.length ? notes[0] : null,
    octave: octaves.length ? octaves[0] : null,
    octaves: octaves,
    accidentals: accidentals,
    ottava: ottava,
    voices: voices,
    finger: null,
    fingers: []
  };
  if (anyGiven) row.givenFingers = givenFingers;
  return row;
}

function restItem(q) {
  return {
    rest: true,
    duration: q.type + 'r',
    beats: q.beats,
    sixteenths: q.sixteenths,
    midi: null,
    midis: [],
    pitch: null,
    pitches: [],
    note: null,
    octave: null,
    octaves: [],
    accidentals: [],
    ottava: null,
    voices: [],
    finger: null,
    fingers: []
  };
}

function staggeredOverlap(events) {
  var i;
  var j;
  for (i = 0; i < events.length; i++) {
    for (j = i + 1; j < events.length; j++) {
      var a = events[i];
      var b = events[j];
      var startGap = a.tStartMs - b.tStartMs;
      if (startGap < 0) startGap = -startGap;
      var overlap = (a.tEndMs < b.tEndMs ? a.tEndMs : b.tEndMs) - (a.tStartMs > b.tStartMs ? a.tStartMs : b.tStartMs);
      if (startGap > CHORD_WINDOW_MS && overlap > CHORD_WINDOW_MS) return true;
    }
  }
  return false;
}

function sameMidis(a, b) {
  if (a.length !== b.length) return false;
  var i;
  for (i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function sliceItems(events, bpm) {
  var fingerByMidi = {};
  var ei;
  for (ei = 0; ei < events.length; ei++) {
    var gf = readFinger(events[ei] && events[ei].finger);
    if (gf != null) fingerByMidi[events[ei].midi] = gf;
  }
  var times = [];
  function addT(t) {
    var i;
    for (i = 0; i < times.length; i++) if (Math.abs(times[i] - t) < 1) return;
    times.push(t);
  }
  var i;
  var j;
  var k;
  for (i = 0; i < events.length; i++) {
    addT(events[i].tStartMs);
    addT(events[i].tEndMs);
  }
  times.sort(function (a, b) { return a - b; });
  var slices = [];
  for (i = 0; i < times.length - 1; i++) {
    var t0 = times[i];
    var t1 = times[i + 1];
    if (t1 - t0 < 1) continue;
    var midis = [];
    for (j = 0; j < events.length; j++) {
      var e = events[j];
      if (e.tStartMs <= t0 + 1 && e.tEndMs + 1 >= t1) {
        var seen = false;
        for (k = 0; k < midis.length; k++) if (midis[k] === e.midi) seen = true;
        if (!seen) midis.push(e.midi);
      }
    }
    midis.sort(function (a, b) { return a - b; });
    if (slices.length && sameMidis(slices[slices.length - 1].midis, midis)) {
      slices[slices.length - 1].t1 = t1;
    } else {
      slices.push({ t0: t0, t1: t1, midis: midis });
    }
  }
  var items = [];
  for (i = 0; i < slices.length; i++) {
    var sl = slices[i];
    var dur = sl.t1 - sl.t0;
    if (dur < CHORD_WINDOW_MS && sl.midis.length && i + 1 < slices.length) {
      var nmid = slices[i + 1].midis.slice();
      for (k = 0; k < sl.midis.length; k++) if (nmid.indexOf(sl.midis[k]) < 0) nmid.push(sl.midis[k]);
      nmid.sort(function (a, b) { return a - b; });
      slices[i + 1].midis = nmid;
      slices[i + 1].t0 = sl.t0;
      continue;
    }
    if (!sl.midis.length) {
      if (dur >= quarterMs(bpm) / 8) items.push(restItem(quantizeDuration(dur, bpm)));
      continue;
    }
    var group = { events: [] };
    for (k = 0; k < sl.midis.length; k++) {
      group.events.push({ midi: sl.midis[k], finger: fingerByMidi[sl.midis[k]] });
    }
    items.push(noteItem(group, quantizeDuration(dur, bpm)));
  }
  return items;
}

function packMeasures(items, cap) {
  var measures = [{ notes: [] }];
  var used = 0;
  function pushPart(proto, sixteenths) {
    var remain = cap - used;
    if (remain <= 0) {
      measures.push({ notes: [] });
      used = 0;
      remain = cap;
    }
    var take = Math.min(sixteenths, remain);
    var parts = greedySixteenths(take);
    var p;
    for (p = 0; p < parts.length; p++) {
      var durType = lookupType(parts[p]);
      var copy = {};
      var key;
      for (key in proto) {
        if (Object.prototype.hasOwnProperty.call(proto, key)) copy[key] = proto[key];
      }
      copy.duration = proto.rest ? durType + 'r' : durType;
      copy.sixteenths = parts[p];
      copy.beats = parts[p] / 4;
      measures[measures.length - 1].notes.push(copy);
      used += parts[p];
    }
    return sixteenths - take;
  }
  var i;
  for (i = 0; i < items.length; i++) {
    var left = items[i].sixteenths;
    while (left > 0) left = pushPart(items[i], left);
  }
  return measures;
}

function sessionType(micOn) {
  return micOn ? 'play-and-record' : 'playback';
}

function denyMessage(errName) {
  if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError' || errName === 'SecurityError') {
    return 'Permiso de micrófono denegado. Sigue con el teclado.';
  }
  if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError') {
    return 'No se encontró un micrófono. Usa el teclado.';
  }
  if (errName === 'NotSupportedError' || errName === 'TypeError') {
    return 'Este navegador no permite el micrófono. Usa el teclado.';
  }
  return 'No se pudo abrir el micrófono. Usa el teclado.';
}

function statusLine(opts) {
  opts = opts || {};
  var base = 'Micrófono activo · una nota a la vez. La melodía del jefe no suena, para que no entre por el mic. Ruido y acordes pueden fallar.';
  if (opts.ios) base += ' En iPhone o iPad, si el altavoz se calla, apaga el micrófono.';
  return base;
}

// --- dos voces: suma armónica, picos locales y un valle entre ellos ---
// La segunda voz solo entra si no se explica como armónico de la primera.
// Por debajo de C3 se deja la decisión al detector monofónico.

var POLY_MIN_MIDI = 48;
var SAL_W = [1, 0.65, 0.45, 0.32, 0.22, 0.15, 0.1, 0.07];
var HANN = {};

function hannWindow(n) {
  if (HANN[n]) return HANN[n];
  var w = new Float64Array(n);
  var i;
  for (i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  HANN[n] = w;
  return w;
}

function fftInPlace(re, im) {
  var n = re.length;
  var i;
  var j = 0;
  for (i = 1; i < n; i++) {
    var bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      var tr = re[i]; re[i] = re[j]; re[j] = tr;
      var ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  var len;
  for (len = 2; len <= n; len <<= 1) {
    var ang = (-2 * Math.PI) / len;
    var wr0 = Math.cos(ang);
    var wi0 = Math.sin(ang);
    var start;
    for (start = 0; start < n; start += len) {
      var wr = 1;
      var wi = 0;
      var k;
      for (k = 0; k < len / 2; k++) {
        var ur = re[start + k];
        var ui = im[start + k];
        var vr = re[start + k + len / 2] * wr - im[start + k + len / 2] * wi;
        var vi = re[start + k + len / 2] * wi + im[start + k + len / 2] * wr;
        re[start + k] = ur + vr;
        im[start + k] = ui + vi;
        re[start + k + len / 2] = ur - vr;
        im[start + k + len / 2] = ui - vi;
        var nwr = wr * wr0 - wi * wi0;
        wi = wr * wi0 + wi * wr0;
        wr = nwr;
      }
    }
  }
}

function spectrumOf(buffer) {
  var n = buffer ? buffer.length : 0;
  var size = 4096;
  if (n > 4096) size = 8192;
  var re = new Float64Array(size);
  var im = new Float64Array(size);
  var w = hannWindow(n > size ? size : n);
  var i;
  var lim = n < size ? n : size;
  if (n > 0 && n <= size) w = hannWindow(n);
  for (i = 0; i < lim; i++) re[i] = buffer[i] * (i < w.length ? w[i] : 1);
  fftInPlace(re, im);
  var half = size >> 1;
  var mag = new Float64Array(half);
  for (i = 0; i < half; i++) mag[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
  return { mag: mag, size: size };
}

function peakNear(mag, freq, sampleRate, size) {
  var binHz = sampleRate / size;
  var center = Math.round(freq / binHz);
  var rad = Math.max(1, Math.round(freq * 0.02 / binHz));
  var lo = center - rad;
  var hi = center + rad;
  if (lo < 1) lo = 1;
  if (hi > mag.length - 2) hi = mag.length - 2;
  var best = 0;
  var i;
  for (i = lo; i <= hi; i++) if (mag[i] > best) best = mag[i];
  return best;
}

function salienceAt(mag, midi, sampleRate, size) {
  var f0 = hzForNote(NAMES[midi % 12], Math.floor(midi / 12) - 1);
  if (!f0) return 0;
  var s = 0;
  var wsum = 0;
  var fund = 0;
  var h2 = 0;
  var k;
  for (k = 1; k <= 8; k++) {
    var fk = k * f0 * Math.sqrt(1 + 0.00012 * k * k);
    if (fk >= sampleRate * 0.47) break;
    var p = peakNear(mag, fk, sampleRate, size);
    if (k === 1) fund = p;
    if (k === 2) h2 = p;
    s += SAL_W[k - 1] * Math.sqrt(p);
    wsum += SAL_W[k - 1];
  }
  if (!wsum) return 0;
  var pen = 1;
  if (h2 > 0 && fund < h2 * 0.35) pen = 0.15;
  else if (h2 > 0 && fund < h2 * 0.62) pen = 0.45;
  return (s / wsum) * pen;
}

function localPeaks(sal, minMidi, maxMidi) {
  function at(m) {
    if (m < minMidi || m > maxMidi) return 0;
    return sal[m] || 0;
  }
  var ps = [];
  var m;
  for (m = minMidi; m <= maxMidi; m++) {
    if (at(m) >= at(m - 1) && at(m) >= at(m + 1) &&
        at(m) >= at(m - 2) && at(m) >= at(m + 2) && at(m) > 0) ps.push(m);
  }
  ps.sort(function (a, b) { return sal[b] - sal[a]; });
  return ps;
}

function valleyRatio(sal, a, b) {
  var lo = a < b ? a : b;
  var hi = a < b ? b : a;
  var m = Infinity;
  var k;
  for (k = lo + 1; k < hi; k++) if (sal[k] < m) m = sal[k];
  if (m === Infinity) return 1;
  var base = sal[a] < sal[b] ? sal[a] : sal[b];
  if (base <= 0) return 1;
  return m / base;
}

function spellDetected(midi) {
  var n = noteFromMidi(midi);
  if (!n) return null;
  return {
    midi: n.midi,
    pitch: n.name + n.octave,
    note: n.name,
    octave: n.octave,
    cents: 0,
    clarity: null
  };
}

function spectralView(buffer, sampleRate, cfg) {
  var empty = { pair: [], top: null };
  if (!buffer || buffer.length < 512 || !sampleRate) return empty;
  var db = rmsDb(buffer);
  if (db < cfg.gateDb) return empty;
  var spec = spectrumOf(buffer);
  var minMidi = cfg.minMidi > POLY_MIN_MIDI ? cfg.minMidi : POLY_MIN_MIDI;
  var maxMidi = cfg.maxMidi < 96 ? cfg.maxMidi : 96;
  if (maxMidi - minMidi < 3) return empty;
  var sal = new Float64Array(128);
  var m;
  for (m = minMidi; m <= maxMidi; m++) sal[m] = salienceAt(spec.mag, m, sampleRate, spec.size);
  var ps = localPeaks(sal, minMidi, maxMidi);
  if (!ps.length || sal[ps[0]] <= 0) return empty;
  var top = spellDetected(ps[0]);
  var pair = [];
  var i;
  for (i = 1; i < ps.length && i < 6; i++) {
    var iv = ps[i] - ps[0];
    if (iv < 0) iv = -iv;
    if (iv < 3) continue;
    var ratio = sal[ps[i]] / sal[ps[0]];
    var dip = valleyRatio(sal, ps[0], ps[i]);
    var harmonic = iv === 12 || iv === 19 || iv === 24;
    var ok = harmonic ? (ratio >= 0.82 && dip < 0.92) : (ratio >= 0.72 && dip <= 0.88);
    if (!ok) continue;
    var a = spellDetected(ps[0]);
    var b = spellDetected(ps[i]);
    if (!a || !b) break;
    pair = a.midi < b.midi ? [a, b] : [b, a];
    break;
  }
  return { pair: pair, top: top };
}

function trackVoices(slots, cands) {
  var ons = [];
  var offs = [];
  var taken = [];
  var matched = [];
  var i;
  var j;
  for (i = 0; i < slots.length; i++) taken[i] = false;
  for (j = 0; j < cands.length; j++) matched[j] = false;
  for (j = 0; j < cands.length; j++) {
    for (i = 0; i < slots.length; i++) {
      if (taken[i] || slots[i].midi == null) continue;
      if (slots[i].midi === cands[j].midi) {
        slots[i].gap = 0;
        slots[i].run = 0;
        slots[i].candMidi = null;
        taken[i] = true;
        matched[j] = true;
        break;
      }
    }
  }
  for (j = 0; j < cands.length; j++) {
    if (matched[j]) continue;
    var si = -1;
    for (i = 0; i < slots.length; i++) {
      if (taken[i] || slots[i].midi != null) continue;
      si = i;
      break;
    }
    if (si < 0) {
      for (i = 0; i < slots.length; i++) {
        if (taken[i] || slots[i].midi == null) continue;
        si = i;
        break;
      }
    }
    if (si < 0) continue;
    var slot = slots[si];
    taken[si] = true;
    var cand = cands[j];
    if (slot.midi == null) {
      if (slot.candMidi === cand.midi) slot.run += 1;
      else {
        slot.candMidi = cand.midi;
        slot.candName = cand.pitch;
        slot.run = 1;
      }
      if (slot.run >= MIN_RUN) {
        slot.midi = cand.midi;
        slot.name = cand.pitch;
        slot.gap = 0;
        slot.run = 0;
        slot.candMidi = null;
        ons.push(cand);
      }
    } else if (slot.midi !== cand.midi) {
      if (slot.candMidi === cand.midi) slot.run += 1;
      else {
        slot.candMidi = cand.midi;
        slot.candName = cand.pitch;
        slot.run = 1;
      }
      if (slot.run >= MIN_RUN) {
        offs.push(slot.name);
        slot.midi = cand.midi;
        slot.name = cand.pitch;
        slot.gap = 0;
        slot.run = 0;
        slot.candMidi = null;
        ons.push(cand);
      }
    }
  }
  for (i = 0; i < slots.length; i++) {
    if (!taken[i] && slots[i].midi == null && slots[i].candMidi != null) {
      slots[i].candMidi = null;
      slots[i].candName = null;
      slots[i].run = 0;
    }
    if (taken[i] || slots[i].midi == null) continue;
    slots[i].gap += 1;
    if (slots[i].gap >= RELEASE_GAPS) {
      offs.push(slots[i].name);
      slots[i].midi = null;
      slots[i].name = null;
      slots[i].gap = 0;
      slots[i].run = 0;
      slots[i].candMidi = null;
      slots[i].candName = null;
    }
  }
  return { on: ons, off: offs };
}

function createCapture(options) {
  options = options || {};
  var profile = PROFILES[options.profile] || PROFILES.score;
  var cfg = {
    minMidi: options.minMidi == null ? profile.minMidi : options.minMidi,
    maxMidi: options.maxMidi == null ? profile.maxMidi : options.maxMidi,
    maxCents: options.maxCents == null ? profile.maxCents : options.maxCents,
    strict: options.strict == null ? profile.strict : options.strict,
    relaxed: options.relaxed == null ? profile.relaxed : options.relaxed,
    gateDb: options.gateDb == null ? profile.gateDb : options.gateDb,
    maxLagMode: options.maxLagMode || profile.maxLagMode,
    a4: (typeof options.a4 === 'number' && options.a4 > 0) ? options.a4 : 440,
    bpm: options.score && options.score.bpm ? options.score.bpm : DEFAULT_BPM,
    timeSig: options.score && options.score.timeSig ? options.score.timeSig : '4/4',
    clef: options.score && options.score.clef ? options.score.clef : 'treble',
    maxVoices: options.maxVoices >= 2 ? 2 : 1
  };
  var mic = createMicState();
  var heldMap = {};
  var events = [];
  var open = {};
  var origin = null;
  var lastNow = 0;

  function rel(now) {
    if (typeof now !== 'number' || !isFinite(now)) now = lastNow;
    lastNow = now;
    if (origin == null) origin = now;
    return now - origin;
  }

  function scoreOpts() {
    return { bpm: cfg.bpm, timeSig: cfg.timeSig, clef: cfg.clef };
  }

  function buildScore() {
    return eventsToScore(events, scoreOpts());
  }

  function heldList() {
    var out = [];
    var names = Object.keys(heldMap);
    var i;
    for (i = 0; i < names.length; i++) {
      var p = parsePitch(names[i]);
      if (!p) continue;
      var sources = [];
      var slot = heldMap[names[i]];
      var k;
      for (k in slot) {
        if (Object.prototype.hasOwnProperty.call(slot, k) && slot[k]) sources.push(k);
      }
      out.push({ pitch: p.pitch, note: p.note, octave: p.octave, midi: p.midi, sources: sources });
    }
    return out;
  }

  function pack(list, reading) {
    var held = heldList();
    var voices = [];
    var i;
    for (i = 0; i < held.length; i++) {
      voices.push({
        pitch: held[i].pitch,
        note: held[i].note,
        octave: held[i].octave,
        midi: held[i].midi
      });
    }
    voices.sort(function (a, b) { return a.midi - b.midi; });
    for (i = 0; i < list.length; i++) list[i].voices = voices;
    return { events: list, held: held, score: buildScore(), reading: reading || null };
  }

  function touchOpen(t) {
    var ids = Object.keys(open);
    var i;
    for (i = 0; i < ids.length; i++) open[ids[i]].tEndMs = t;
  }

  function ensureOpen(midi, t, clarity, finger) {
    var f = readFinger(finger);
    if (open[midi]) {
      open[midi].tEndMs = t;
      if (f != null && open[midi].finger == null) open[midi].finger = f;
      return;
    }
    var row = { midi: midi, score: clarity || 1, chord: false, tStartMs: t, tEndMs: t, count: 1 };
    if (f != null) row.finger = f;
    events.push(row);
    open[midi] = row;
  }

  function closeScore(midi, t) {
    if (!open[midi]) return;
    open[midi].tEndMs = Math.max(open[midi].tStartMs, t);
    delete open[midi];
  }

  function onEvent(p, source, t, merged, extra) {
    extra = extra || {};
    return {
      type: 'on',
      pitch: p.pitch,
      note: p.note,
      octave: p.octave,
      midi: p.midi,
      cents: extra.cents || 0,
      clarity: extra.clarity == null ? null : extra.clarity,
      source: source,
      sound: !!merged.sound,
      combat: !!merged.combat,
      fresh: !!merged.fresh,
      released: false,
      t: t
    };
  }

  function offEvent(p, source, t, released) {
    return {
      type: 'off',
      pitch: p ? p.pitch : null,
      note: p ? p.note : null,
      octave: p ? p.octave : null,
      midi: p ? p.midi : null,
      source: source,
      sound: false,
      combat: false,
      fresh: false,
      released: !!released,
      t: t
    };
  }

  function applyEdge(kind, pitchStr, source, t, merged, extra) {
    var p = parsePitch(pitchStr);
    if (!p) return null;
    if (kind === 'on') {
      if (merged.fresh) ensureOpen(p.midi, t, extra && extra.clarity, extra && extra.finger);
      return onEvent(p, source, t, merged, extra);
    }
    if (merged.released) closeScore(p.midi, t);
    return offEvent(p, source, t, merged.released);
  }

  function press(pitch, source, nowMs, extra) {
    var p = parsePitch(pitch);
    var t = rel(nowMs);
    if (!p || p.midi < cfg.minMidi || p.midi > cfg.maxMidi) return pack([], null);
    source = source || 'key';
    var merged = mergePress(heldMap, p.pitch, source);
    var ev = applyEdge('on', p.pitch, source, t, merged, {
      cents: p.cents,
      clarity: 1,
      finger: extra && typeof extra === 'object' ? extra.finger : null
    });
    touchOpen(t);
    return pack(ev ? [ev] : [], null);
  }

  function release(pitch, source, nowMs) {
    var p = parsePitch(pitch);
    var t = rel(nowMs);
    if (!p) return pack([], null);
    source = source || 'key';
    var merged = mergeRelease(heldMap, p.pitch, source);
    var ev = applyEdge('off', p.pitch, source, t, merged, null);
    touchOpen(t);
    return pack(ev ? [ev] : [], null);
  }

  function advance(nowMs) {
    var t = rel(nowMs);
    touchOpen(t);
    return pack([], null);
  }

  function releaseSource(source, nowMs) {
    var t = rel(nowMs);
    var out = [];
    var names = Object.keys(heldMap);
    var i;
    for (i = 0; i < names.length; i++) {
      var slot = heldMap[names[i]];
      if (!slot || !slot[source]) continue;
      var merged = mergeRelease(heldMap, names[i], source);
      var ev = applyEdge('off', names[i], source, t, merged, null);
      if (ev) out.push(ev);
    }
    if (source === 'mic') resetMicState(mic);
    touchOpen(t);
    return pack(out, null);
  }

  function reset(nowMs) {
    var names = Object.keys(heldMap);
    var out = [];
    var t = (typeof nowMs === 'number') ? rel(nowMs) : 0;
    var i;
    for (i = 0; i < names.length; i++) {
      var p = parsePitch(names[i]);
      out.push(offEvent(p, null, t, true));
    }
    heldMap = {};
    events = [];
    open = {};
    resetMicState(mic);
    origin = null;
    return { events: out, held: [], score: eventsToScore([], scoreOpts()), reading: null };
  }

  function emitEdges(out, edge, t, extra) {
    var i;
    if (edge.off) {
      for (i = 0; i < edge.off.length; i++) {
        var offMerged = mergeRelease(heldMap, edge.off[i], 'mic');
        var offEv = applyEdge('off', edge.off[i], 'mic', t, offMerged, null);
        if (offEv) out.push(offEv);
      }
    }
    if (edge.on) {
      for (i = 0; i < edge.on.length; i++) {
        var cand = edge.on[i];
        var onMerged = mergePress(heldMap, cand.pitch, 'mic');
        var onEv = applyEdge('on', cand.pitch, 'mic', t, onMerged, {
          cents: cand.cents || 0,
          clarity: cand.clarity
        });
        if (onEv) out.push(onEv);
      }
    }
    if (extra && extra.off) {
      var offMerged2 = mergeRelease(heldMap, extra.off, 'mic');
      var offEv2 = applyEdge('off', extra.off, 'mic', t, offMerged2, null);
      if (offEv2) out.push(offEv2);
    }
    if (extra && extra.on) {
      var onMerged2 = mergePress(heldMap, extra.on, 'mic');
      var onEv2 = applyEdge('on', extra.on, 'mic', t, onMerged2, extra);
      if (onEv2) out.push(onEv2);
    }
  }

  function hop(buffer, sampleRate, nowMs, hopOpts) {
    hopOpts = hopOpts || {};
    var t = rel(nowMs);
    var sr = sampleRate || 48000;
    if (cfg.maxVoices < 2) {
      var obs1 = observeMic(mic, buffer, sr, cfg);
      var midi = obs1.midi;
      var pitch = obs1.pitch;
      if (pitch && isBlocked(hopOpts.blocked, midi, nowMs)) {
        midi = null;
        pitch = null;
        if (obs1.reading) obs1.reading.accepted = false;
      }
      var mono = hopMachine(mic, { midi: pitch ? midi : null, pitch: pitch });
      var monoOut = [];
      emitEdges(monoOut, { on: [], off: [] }, t, {
        off: mono.off,
        on: mono.on,
        cents: obs1.cents || (obs1.reading && obs1.reading.cents) || 0,
        clarity: obs1.clarity || (obs1.reading && obs1.reading.clarity) || null
      });
      touchOpen(t);
      return pack(monoOut, obs1.reading);
    }
    var view = spectralView(buffer, sr, cfg);
    var obs = observeMic(mic, buffer, sr, cfg);
    var cands = [];
    var pi;
    if (view.pair.length >= 2) {
      mic.votes = [];
      for (pi = 0; pi < view.pair.length; pi++) {
        if (!isBlocked(hopOpts.blocked, view.pair[pi].midi, nowMs)) cands.push(view.pair[pi]);
      }
      if (cands.length < 2) cands = [];
    }
    if (!cands.length && obs.midi != null && obs.pitch && !isBlocked(hopOpts.blocked, obs.midi, nowMs)) {
      cands.push({
        midi: obs.midi,
        pitch: obs.pitch,
        note: obs.reading && obs.reading.note,
        octave: obs.reading && obs.reading.octave,
        cents: obs.cents || (obs.reading && obs.reading.cents) || 0,
        clarity: obs.clarity || (obs.reading && obs.reading.clarity) || null
      });
    } else if (!cands.length && view.top && !isBlocked(hopOpts.blocked, view.top.midi, nowMs)) {
      for (pi = 0; pi < mic.slots.length; pi++) {
        if (mic.slots[pi].midi === view.top.midi) cands.push(view.top);
      }
    }
    var edge = trackVoices(mic.slots, cands);
    var out = [];
    emitEdges(out, edge, t, null);
    touchOpen(t);
    return pack(out, obs.reading);
  }

  return {
    hop: hop,
    press: press,
    release: release,
    advance: advance,
    releaseSource: releaseSource,
    reset: reset,
    score: buildScore,
    held: heldList
  };
}

export {
  INTERFACE,
  VERSION,
  HOP_MS,
  createCapture,
  detectPitch,
  noteFromFreq,
  noteFromMidi,
  hzForNote,
  suggestFingering,
  sessionType,
  denyMessage,
  statusLine
};
