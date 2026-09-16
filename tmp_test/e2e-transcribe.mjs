// e2e-transcribe.mjs — prueba VISUAL del pipeline completo contra GitHub Pages LIVE
// Inyecta piano-test.wav como micrófono (--use-fake-device-for-media-stream),
// escucha la página real, toca Escuchar y captura la lista resultado.
import { chromium } from 'playwright';
import fs from 'fs';

const WAV = 'C:/Users/Rog/Workspace/01_PROYECTOS/piano-game/tmp_test/piano-test.wav';

const browser = await chromium.launch({
  args: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream', // auto-concede permisos
    `--use-file-for-fake-audio-capture=${WAV}`,
  ]
});
const page = await browser.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

await page.goto('https://juliangdeveloper.github.io/piano-game/', { waitUntil: 'networkidle' });
const version = await page.locator('#version').textContent();

// abrir ajustes y elegir mic (default), cerrar
await page.click('#btnSettings');
const micChecked = await page.locator('#settings input[value=mic]').isChecked();
await page.click('#btnSettings');

// arrancar y dejar correr el WAV completo + margen
await page.click('#btnToggle');
await page.waitForTimeout(6000);

const rows = await page.locator('#noteLog.chrono li').allTextContents();
const hint = await page.locator('#hint').textContent();
await page.screenshot({ path: 'C:/Users/Rog/Workspace/01_PROYECTOS/piano-game/tmp_test/e2e-result.png', fullPage: false });

console.log(JSON.stringify({
  version, micChecked, hint,
  rowsCount: rows.length,
  rows,
  consoleErrors: errors
}, null, 2));
await browser.close();