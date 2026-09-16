const { chromium } = require('C:/Users/Rog/AppData/Local/hermes/hermes-agent/node_modules/playwright');
(async () => {
  const browser = await chromium.launch({
    args: ['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',
      '--use-file-for-fake-audio-capture=C:/Users/Rog/Workspace/01_PROYECTOS/piano-game/tmp_test/julian-piano.wav',
      '--fake-device-playback-time=8000']
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto('https://juliangdeveloper.github.io/piano-game/', { waitUntil: 'networkidle' });
  await page.click('#btnSettings'); await page.click('#btnSettings');
  await page.click('#btnToggle');
  await page.waitForTimeout(9000);
  await page.screenshot({ path: 'e2e-top390.png' }); // viewport móvil, viewport shot = arriba
  const display = await page.locator('#noteDisplay').textContent();
  const version = await page.locator('#version').textContent();
  const rows = await page.locator('#noteLog.chrono li').count();
  console.log(JSON.stringify({ display, version, rows }));
  await browser.close();
})();
