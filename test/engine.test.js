// test/engine.test.js — contrato público de engine/v1/capture.js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

async function engine() {
  return import(path.join('file://', __dirname, '..', 'engine', 'v1', 'capture.js'));
}

function sine(freq, n, sr, amp) {
  n = n || 2048;
  sr = sr || 48000;
  amp = amp == null ? 0.2 : amp;
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) buf[i] = amp * Math.sin(2 * Math.PI * freq * i / sr);
  return buf;
}

function piano(freq, n, sr) {
  n = n || 2048;
  sr = sr || 48000;
  const amps = [1, 0.5, 0.25, 0.12];
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let s = 0;
    for (let k = 0; k < amps.length; k++) s += amps[k] * Math.sin(2 * Math.PI * freq * (k + 1) * t);
    buf[i] = 0.2 * s;
  }
  return buf;
}

function feed(mod, profile, buf, hops, extra) {
  const session = mod.createCapture({ profile: profile });
  const ons = [];
  const offs = [];
  for (let i = 0; i < hops; i++) {
    const out = session.hop(buf, 48000, i * mod.HOP_MS, extra);
    out.events.forEach(function (ev) {
      if (ev.type === 'on') ons.push({ i: i, ev: ev });
      if (ev.type === 'off') offs.push({ i: i, ev: ev });
    });
  }
  return { session: session, ons: ons, offs: offs };
}

test('la versión publicada coincide con version.txt y la interfaz es 1', async () => {
  const mod = await engine();
  const file = fs.readFileSync(path.join(__dirname, '..', 'engine', 'v1', 'version.txt'), 'utf8').trim();
  assert.strictEqual(mod.VERSION, '1.11.0');
  assert.strictEqual(file, mod.VERSION);
  assert.strictEqual(mod.INTERFACE, 1);
  assert.strictEqual(mod.HOP_MS, 20);
});

test('el módulo no toca el DOM ni VexFlow y no importa otros archivos', async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'engine', 'v1', 'capture.js'), 'utf8');
  assert.equal(/\bimport\s/.test(src), false);
  assert.equal(/\bdocument\b/.test(src), false);
  assert.equal(/\bwindow\b/.test(src), false);
  assert.equal(/vexflow/i.test(src), false);
  assert.equal(/localStorage/.test(src), false);
});

test('YIN del motor coincide con js/pitch.js en graves y agudos', async () => {
  const mod = await engine();
  const Pitch = require(path.join(__dirname, '..', 'js', 'pitch.js'));
  const cases = [
    ['A4', 440, 4096, null],
    ['E3', mod.hzForNote('E', 3), 4096, null],
    ['D4', mod.hzForNote('D', 4), 4096, null],
    ['E2', mod.hzForNote('E', 2), 4096, null],
    ['C4', 261.6256, 4096, 400]
  ];
  for (const row of cases) {
    const buf = sine(row[1], row[2], 48000, 0.5);
    const opts = row[3] ? { maxLag: row[3] } : {};
    const a = Pitch.detectPitch(buf, 48000, opts);
    const b = mod.detectPitch(buf, 48000, opts);
    assert.ok(a.freq != null && b.freq != null, row[0]);
    assert.ok(Math.abs(a.freq - b.freq) < 0.05, row[0] + ' ' + a.freq + ' vs ' + b.freq);
    const na = Pitch.noteFromFreq(a.freq);
    const nb = mod.noteFromFreq(b.freq);
    assert.strictEqual(na.name + na.octave, nb.name + nb.octave);
  }
});

test('E3 y D4 entran al tercer hop, igual en partitura y en combate', async () => {
  const mod = await engine();
  for (const profile of ['score', 'combat']) {
    for (const name of ['E3', 'D4']) {
      const note = name[0];
      const oct = Number(name[1]);
      const got = feed(mod, profile, piano(mod.hzForNote(note, oct)), 6);
      assert.strictEqual(got.ons.length, 1, profile + ' ' + name);
      assert.strictEqual(got.ons[0].i, 2, 'latencia de 3 hops / ' + (3 * mod.HOP_MS) + ' ms');
      assert.strictEqual(got.ons[0].ev.pitch, name);
      assert.strictEqual(got.ons[0].ev.sound, false);
      assert.strictEqual(got.ons[0].ev.combat, true);
    }
  }
});

test('la partitura oye C2 y el perfil de combate no', async () => {
  const mod = await engine();
  const buf = sine(mod.hzForNote('C', 2), 4096, 48000, 0.5);
  const score = feed(mod, 'score', buf, 6);
  const combat = feed(mod, 'combat', buf, 6);
  assert.strictEqual(score.ons[0].ev.pitch, 'C2');
  assert.strictEqual(combat.ons.length, 0);
});

test('el silencio suelta la nota a los 3 hops y queda en la partitura', async () => {
  const mod = await engine();
  const session = mod.createCapture({ profile: 'score', score: { bpm: 80, timeSig: '4/4' } });
  const buf = piano(mod.hzForNote('E', 3));
  let onAt = -1;
  let offAt = -1;
  for (let i = 0; i < 12; i++) {
    const frame = i < 6 ? buf : new Float32Array(2048);
    const out = session.hop(frame, 48000, i * mod.HOP_MS);
    out.events.forEach(function (ev) {
      if (ev.type === 'on') onAt = i;
      if (ev.type === 'off' && ev.released) offAt = i;
    });
  }
  assert.strictEqual(onAt, 2);
  // La votación aguanta un frame y luego hacen falta 3 hops en silencio (RELEASE_GAPS).
  assert.strictEqual(offAt, 9);
  const notes = session.score().measures[0].notes.filter(function (n) { return !n.rest; });
  assert.ok(notes.length >= 1);
  assert.strictEqual(notes[0].pitch, 'E3');
  assert.strictEqual(notes[0].octave, 3);
  assert.strictEqual(notes[0].note, 'E');
  assert.strictEqual(typeof notes[0].beat, 'number');
  assert.strictEqual(notes[0].measure, 0);
});

test('un bloqueo de altavoz no deja pasar la nota, el vecino ni la octava', async () => {
  const mod = await engine();
  const buf = sine(mod.hzForNote('C', 4));
  function blocked(midi) {
    return feed(mod, 'combat', buf, 6, { blocked: [{ midi: midi, until: 10000 }] }).ons.length;
  }
  assert.strictEqual(blocked(60), 0);
  assert.strictEqual(blocked(61), 0);
  assert.strictEqual(blocked(72), 0);
  assert.strictEqual(blocked(48), 0);
  assert.ok(feed(mod, 'combat', buf, 6, { blocked: [{ midi: 64, until: 10000 }] }).ons.length > 0);
});

test('tecla y micrófono no disparan dos veces; la tecla sí suena', async () => {
  const mod = await engine();
  const session = mod.createCapture({ profile: 'combat' });
  const key = session.press('C4', 'key', 0);
  assert.strictEqual(key.events[0].combat, true);
  assert.strictEqual(key.events[0].sound, true);
  const buf = sine(mod.hzForNote('C', 4));
  let mic = null;
  for (let i = 0; i < 6; i++) {
    const out = session.hop(buf, 48000, 50 + i * mod.HOP_MS);
    out.events.forEach(function (ev) { if (ev.type === 'on') mic = ev; });
  }
  assert.ok(mic);
  assert.strictEqual(mic.combat, false);
  assert.strictEqual(mic.sound, false);
  const again = session.press('C4', 'key', 200);
  assert.strictEqual(again.events[0].fresh, false);
  assert.strictEqual(again.events[0].sound, false);
  const dropMic = session.release('C4', 'mic', 220);
  assert.strictEqual(dropMic.events[0].released, false);
  const dropKey = session.release('C4', 'key', 240);
  assert.strictEqual(dropKey.events[0].released, true);
  assert.strictEqual(session.held().length, 0);
});

test('cuantiza a ♩=80: negra, silencio, acorde, compás y 8vb', async () => {
  const mod = await engine();
  const s = mod.createCapture({ profile: 'score', score: { bpm: 80, timeSig: '4/4', clef: 'treble' } });
  s.press(60, 'midi', 0);
  s.release(60, 'midi', 750);
  s.press(64, 'midi', 1500);
  s.release(64, 'midi', 2250);
  const notes = s.score().measures[0].notes;
  assert.strictEqual(notes[0].rest, false);
  assert.strictEqual(notes[0].pitch, 'C4');
  assert.strictEqual(notes[0].duration, 'q');
  assert.strictEqual(notes[0].beat, 0);
  assert.strictEqual(notes[0].measure, 0);
  assert.strictEqual(notes[1].rest, true);
  assert.strictEqual(notes[1].duration, 'qr');
  assert.strictEqual(notes[1].beat, 1);
  assert.strictEqual(notes[2].pitch, 'E4');
  assert.strictEqual(notes[2].beat, 2);

  const chord = mod.createCapture({ profile: 'score', score: { bpm: 80, timeSig: '4/4' } });
  chord.press(60, 'midi', 0);
  chord.press(64, 'midi', 10);
  chord.release(60, 'midi', 750);
  chord.release(64, 'midi', 750);
  const chordNotes = chord.score().measures[0].notes.filter(function (n) { return !n.rest; });
  assert.strictEqual(chordNotes.length, 1);
  assert.deepStrictEqual(chordNotes[0].pitches, ['C4', 'E4']);
  assert.strictEqual(chordNotes[0].duration, 'q');

  const bars = mod.createCapture({ profile: 'score', score: { bpm: 80, timeSig: '4/4' } });
  for (let i = 0; i < 5; i++) {
    bars.press(60 + i * 2, 'midi', i * 750);
    bars.release(60 + i * 2, 'midi', (i + 1) * 750);
  }
  const score = bars.score();
  assert.strictEqual(score.measures.length, 2);
  assert.strictEqual(score.measures[0].notes.length, 4);
  assert.strictEqual(score.measures[1].notes[0].measure, 1);
  assert.strictEqual(score.measures[1].notes[0].beat, 0);
  assert.strictEqual(score.timeSigStr, '4/4');
  assert.strictEqual(score.bpm, 80);

  const low = mod.createCapture({ profile: 'score', score: { bpm: 80 } });
  low.press(36, 'midi', 0);
  low.release(36, 'midi', 750);
  const c2 = low.score().measures[0].notes[0];
  assert.strictEqual(c2.pitch, 'C2');
  assert.strictEqual(c2.octave, 2);
  assert.strictEqual(c2.ottava, '8vb');
});

test('mensajes de micrófono y sesión de audio', async () => {
  const mod = await engine();
  assert.match(mod.denyMessage('NotAllowedError'), /denegado/);
  assert.match(mod.denyMessage('NotFoundError'), /micrófono/i);
  assert.match(mod.denyMessage('NotSupportedError'), /navegador/);
  assert.strictEqual(mod.sessionType(false), 'playback');
  assert.strictEqual(mod.sessionType(true), 'play-and-record');
  assert.match(mod.statusLine({ ios: true }), /altavoz/);
  assert.equal(/altavoz/.test(mod.statusLine({ ios: false })), false);
});
