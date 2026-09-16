const { chromium } = require('C:/Users/Rog/AppData/Local/hermes/hermes-agent/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--use-file-for-fake-audio-capture=C:/Users/Rog/Workspace/01_PROYECTOS/piano-game/tmp_test/piano-full.wav',
      '--autoplay-policy=no-user-gesture-required'
    ]
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

  await page.goto('https://juliangdeveloper.github.io/piano-game/', { waitUntil: 'networkidle' });
  const version = await page.locator('#version').textContent();

  await page.click('#btnSettings');
  const micChecked = await page.locator('#settings input[value=mic]').isChecked();
  await page.click('#btnSettings');

  await page.click('#btnToggle');
  // el WAV dura ~25s + colas de decay: esperar 29s con progreso incremental
  let rows = [];
  for (let w = 0; w < 29; w += 4) {
    await page.waitForTimeout(4000);
    rows = await page.locator('#noteLog.chrono li').allTextContents();
    process.stdout.write(`t=${w+4}s rows=${rows.length}\n`);
  }
  const hint = await page.locator('#hint').textContent();
  await page.screenshot({ path: 'e2e-full-result.png', fullPage: false });

  // resumen: qué midis salieron en orden
  const midis = rows.map(r => r);
  console.log(JSON.stringify({
    version, micChecked, hint,
    rowsCount: rows.length,
    primeras15: rows.slice(0, 15),
    ultimas10: rows.slice(-10),
    errorCount: errors.length,
    primerosErrores: errors.slice(0, 3)
  }, null, 2));
  await browser.close();
})();
