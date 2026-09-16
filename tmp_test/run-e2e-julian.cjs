const { chromium } = require('C:/Users/Rog/AppData/Local/hermes/hermes-agent/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--use-file-for-fake-audio-capture=C:/Users/Rog/Workspace/01_PROYECTOS/piano-game/tmp_test/julian-piano.wav',
      '--fake-device-playback-time=35440'
    ]
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto('https://juliangdeveloper.github.io/piano-game/', { waitUntil: 'networkidle' });
  const version = await page.locator('#version').textContent();
  await page.click('#btnSettings'); await page.click('#btnSettings');
  await page.click('#btnToggle');
  await page.waitForTimeout(39000); // audio 35.4s + colas
  const rows = await page.locator('#noteLog.chrono li').allTextContents();
  await page.screenshot({ path: 'e2e-julian.png' });

  const seq = rows.map(r => r.match(/^#\d+ ([A-G]#?\d)/)[1]);
  console.log(JSON.stringify({
    version,
    totalRows: rows.length,
    secuenciaCompleta: seq,
    primeras20rows: rows.slice(0, 20),
    errorCount: errors.length,
    errores: errors.slice(0, 3)
  }, null, 2));
  await browser.close();
})();
