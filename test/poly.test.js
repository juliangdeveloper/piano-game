// test/poly.test.js — dos voces opt-in, sin cambiar el camino de una nota.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

async function engine() {
  return import(path.join('file://', __dirname, '..', 'engine', 'v1', 'capture.js'));
}

function hz(mod, midi) {
  const n = mod.noteFromMidi(midi);
  return mod.hzForNote(n.name, n.octave);
}

function piano(midi, n, sr, amp, B) {
  n = n || 2048;
  sr = sr || 48000;
  amp = amp == null ? 0.22 : amp;
  B = B == null ? 0.00015 : B;
  const f0 = 440 * Math.pow(2, (midi - 69) / 12);
  const amps = [1, 0.55, 0.32, 0.18, 0.11, 0.07, 0.04, 0.025];
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    const t = i / sr;
    for (let k = 0; k < amps.length; k++) {
      const fk = (k + 1) * f0 * Math.sqrt(1 + B * (k + 1) * (k + 1));
      s += amps[k] * Math.sin(2 * Math.PI * fk * t + 0.3 * k);
    }
    buf[i] = amp * s;
  }
  return buf;
}

function mix(a, b) {
  const o = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) o[i] = a[i] + b[i];
  return o;
}

function run(mod, buf, opts, hops) {
  const session = mod.createCapture(opts);
  const ons = [];
  let last = null;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < hops; i++) {
    last = session.hop(buf, 48000, i * mod.HOP_MS);
    last.events.forEach(function (ev) {
      if (ev.type === 'on') ons.push({ i: i, pitch: ev.pitch, midi: ev.midi, voices: ev.voices });
    });
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { session: session, ons: ons, held: last ? last.held : [], ms: ms };
}

test('maxVoices 1 no cambia la nota única ni inventa una segunda', async () => {
  const mod = await engine();
  for (const midi of [48, 52, 60, 64, 67, 72, 81]) {
    const buf = piano(midi);
    const mono = run(mod, buf, { profile: 'score' }, 6);
    const poly = run(mod, buf, { profile: 'score', maxVoices: 2 }, 6);
    const name = mod.noteFromMidi(midi);
    const pitch = name.name + name.octave;
    assert.strictEqual(mono.ons.length, 1, pitch);
    assert.strictEqual(poly.ons.length, 1, pitch + ' segunda voz');
    assert.strictEqual(mono.ons[0].pitch, pitch);
    assert.strictEqual(poly.ons[0].pitch, pitch);
    assert.strictEqual(poly.ons[0].i, mono.ons[0].i);
    assert.strictEqual(mono.ons[0].i, 2);
  }
});

test('el perfil combat sin maxVoices sigue en una nota', async () => {
  const mod = await engine();
  const buf = mix(piano(60), piano(64));
  const got = run(mod, buf, { profile: 'combat' }, 6);
  assert.ok(got.ons.length <= 1);
});

test('acordes de prueba: terceras, quintas, octavas y bajo con melodía', async () => {
  const mod = await engine();
  const cases = [
    [60, 63], [60, 64], [60, 67], [60, 72],
    [48, 52], [55, 59], [52, 59], [48, 64], [55, 74]
  ];
  let ok = 0;
  for (const pair of cases) {
    const buf = mix(piano(pair[0]), piano(pair[1]));
    const got = run(mod, buf, { profile: 'score', maxVoices: 2 }, 6);
    const midis = got.ons.map(function (ev) { return ev.midi; }).sort(function (a, b) { return a - b; });
    const hit = midis.length === 2 && midis[0] === pair[0] && midis[1] === pair[1];
    if (hit) {
      ok += 1;
      assert.ok(got.ons[0].i <= 2, 'latencia');
      assert.ok(got.ons[0].voices && got.ons[0].voices.length === 2);
    }
  }
  assert.ok(ok >= 8, 'dyads ' + ok + '/' + cases.length);

  const session = mod.createCapture({
    profile: 'score',
    maxVoices: 2,
    score: { bpm: 80, timeSig: '4/4' }
  });
  const bass = piano(48, 2048, 48000, 0.18);
  const e4 = piano(64, 2048, 48000, 0.24);
  const g4 = piano(67, 2048, 48000, 0.24);
  for (let i = 0; i < 20; i++) {
    const mel = i < 10 ? e4 : g4;
    session.hop(mix(bass, mel), 48000, i * mod.HOP_MS);
  }
  const notes = [];
  session.score().measures.forEach(function (measure) {
    measure.notes.forEach(function (n) { if (!n.rest) notes.push(n); });
  });
  const chord = notes.find(function (n) {
    return n.midis && n.midis.indexOf(48) >= 0 && n.midis.indexOf(64) >= 0;
  });
  assert.ok(chord, 'bajo C3 bajo Mi4');
  assert.strictEqual(chord.note, 'C');
  assert.strictEqual(chord.octave, 3);
  assert.ok(chord.voices && chord.voices.length === 2);
  assert.strictEqual(typeof chord.measure, 'number');
  assert.ok(notes.some(function (n) {
    return n.midis && n.midis.indexOf(48) >= 0 && n.midis.indexOf(67) >= 0;
  }));
});

test('barrido C3–A5: la nota sola no empeora y casi no hay segunda falsa', async () => {
  const mod = await engine();
  let same = 0;
  let false2 = 0;
  let n = 0;
  let hopMs = 0;
  let hops = 0;
  for (let midi = 48; midi <= 81; midi++) {
    for (const B of [0, 0.00015]) {
      n += 1;
      const buf = piano(midi, 2048, 48000, 0.22, B);
      const mono = run(mod, buf, { profile: 'score' }, 6);
      const poly = run(mod, buf, { profile: 'score', maxVoices: 2 }, 6);
      hopMs += poly.ms;
      hops += 6;
      if (mono.ons.length === 1 && poly.ons.length === 1 &&
          mono.ons[0].pitch === poly.ons[0].pitch &&
          mono.ons[0].i === poly.ons[0].i) same += 1;
      if (poly.ons.length > 1) false2 += 1;
    }
  }
  assert.ok(same / n >= 0.98, 'iguales ' + same + '/' + n);
  assert.ok(false2 / n <= 0.02, 'segunda falsa ' + false2 + '/' + n);
  assert.ok(hopMs / hops < 5, 'ms/hop ' + (hopMs / hops).toFixed(2));
});

test('intervalos iguales de C3 a A5', async () => {
  const mod = await engine();
  const intervals = [3, 4, 5, 7, 8, 9, 12];
  let ok = 0;
  let total = 0;
  let late = 0;
  for (const iv of intervals) {
    for (let root = 48; root <= 76; root++) {
      const top = root + iv;
      if (top > 93) continue;
      total += 1;
      const buf = mix(piano(root), piano(top));
      const got = run(mod, buf, { profile: 'score', maxVoices: 2 }, 5);
      const midis = got.ons.map(function (ev) { return ev.midi; });
      if (midis.indexOf(root) >= 0 && midis.indexOf(top) >= 0 && got.ons.length === 2) {
        ok += 1;
        const at = Math.max(got.ons[0].i, got.ons[1].i);
        if (at > 2) late += 1;
      }
    }
  }
  assert.ok(ok / total >= 0.9, 'dyads ' + ok + '/' + total);
  assert.ok(late / ok <= 0.05, 'tarde ' + late);
});
