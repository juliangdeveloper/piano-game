const { chromium } = require('C:/Users/Rog/AppData/Local/hermes/hermes-agent/node_modules/playwright');
(async () => {
  const browser = await chromium.launch({
    args: ['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',
      '--use-file-for-fake-audio-capture=C:/Users/Rog/Workspace/01_PROYECTOS/piano-game/tmp_test/julian-piano.wav',
      '--fake-device-playback-time=35440']
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('https://juliangdeveloper.github.io/piano-game/', { waitUntil: 'networkidle' });
  await page.click('#btnSettings'); await page.click('#btnSettings');
  await page.click('#btnToggle');
  await page.waitForTimeout(12000); // en pleno audio
  await page.screenshot({ path: 'e2e-v166-mid.png' });
  const mid = {
    display: await page.locator('#noteDisplay').textContent(),
    noteDb: await page.locator('#noteDb').textContent(),
    freq: await page.locator('#freqText').textContent()
  };
  await page.waitForTimeout(28000); // fin
  const end = {
    display: await page.locator('#noteDisplay').textContent(),
    noteDb: await page.locator('#noteDb').textContent()
  };
  const rows = await page.locator('#noteLog.chrono li').count();
  console.log(JSON.stringify({ version: await page.locator('#version').textContent(), mid, end, rows, errores: errors }));
  await browser.close();
})();
