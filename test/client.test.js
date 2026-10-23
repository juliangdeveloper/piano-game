// test/client.test.js — la página solo entra al motor por el URL público.
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
  assert.ok(html.includes('js/meta.js?v=1.12.3'));
  assert.ok(html.includes('js/progress.js?v=1.12.3'));
  assert.ok(html.includes('js/vexflow.js?v=1.12.3'));
  assert.ok(html.includes('js/app.js?v=1.12.3'));
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
