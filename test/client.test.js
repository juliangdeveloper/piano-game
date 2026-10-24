'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('la interfaz carga /engine/v1/ y no los archivos internos', () => {
  const app = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const url = 'https://juliangdeveloper.github.io/piano-transcribe/engine/v1/';
  assert.ok(app.includes(url), 'app.js usa el URL público');
  assert.ok(app.includes('capture.js?v='));
  assert.ok(app.includes('version.txt?t='));
  assert.ok(app.includes("cache: 'no-store'"));
  assert.ok(app.includes('mod.INTERFACE !== 1'));
  assert.ok(app.includes('profile: \'score\''));
  assert.ok(app.includes('maxVoices: 2'));
  assert.equal(/from\s+['"][^'"]*engine/.test(app), false);
  assert.equal(/js\/pitch\.js/.test(app), false);
  assert.equal(/window\.Pitch/.test(app), false);
  assert.equal(/window\.Score/.test(app), false);
  assert.equal(/EventStream/.test(app), false);
  assert.equal(/js\/pitch\.js/.test(html), false);
  assert.equal(/js\/score\.js/.test(html), false);
  assert.equal(/js\/gate\.js/.test(html), false);
  assert.ok(html.includes('js/meta.js?v=1.12.9'));
  assert.ok(html.includes('js/progress.js?v=1.12.9'));
  assert.ok(html.includes('js/vexflow.js?v=1.12.9'));
  assert.ok(html.includes('js/app.js?v=1.12.9'));
  assert.ok(html.includes('js/staff.js?v=1.12.9'));
  assert.ok(html.indexOf('js/vexflow.js') < html.indexOf('js/staff.js'));
  assert.ok(html.indexOf('js/staff.js') < html.indexOf('js/app.js'));
  assert.ok(html.indexOf('js/meta.js') < html.indexOf('js/progress.js'));
  assert.ok(html.indexOf('js/progress.js') < html.indexOf('js/app.js'));
  assert.ok(app.includes('progress.load'));
  assert.ok(app.includes('progress.beginSession'));
  assert.ok(app.includes('progress.captureNote'));
  assert.ok(app.includes('progress.endSession'));
  assert.ok(html.includes('piano-transcribe'));
  assert.ok(readme.includes(url));
  assert.ok(readme.includes('capture.js?v='));
});

test('VexFlow 5 core con la fuente Gonville local, sin dibujar antes de que cargue', () => {
  const app = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
  const vf = fs.readFileSync(path.join(root, 'js', 'vexflow.js'), 'utf8');
  const font = fs.readFileSync(path.join(root, 'fonts', 'gonville.woff2'));
  assert.ok(vf.startsWith('/*!\n * VexFlow 5.0.0 '));
  assert.ok(vf.includes('vexflow-core'));
  assert.equal(/sourceMappingURL/.test(vf), false);
  assert.equal(/cdn\.jsdelivr|unpkg/.test(app), false);
  assert.strictEqual(font.subarray(0, 4).toString('latin1'), 'wOF2');
  assert.ok(app.includes('window.VexFlow'));
  assert.equal(/Vex\.Flow|setMusicFont/.test(app), false);
  assert.ok(app.includes("FAMILY: 'Gonville'"));
  assert.ok(app.includes("URL: 'fonts/gonville.woff2'"));
  assert.ok(app.includes('setFonts(MUSIC_FONT.FAMILY)'));
  assert.ok(app.includes('new FontFace('));
  assert.ok(app.includes('document.fonts.add(face)'));
  assert.ok(app.includes('if (!elStaff || !fontReady) return;'));
  assert.ok(app.includes('window.Staff.draw('));
});
