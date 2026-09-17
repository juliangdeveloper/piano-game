const { chromium } = require('C:/Users/Rog/AppData/Local/hermes/hermes-agent/node_modules/playwright');
(async () => {
  const browser = await chromium.launch({
    args: ['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',
      '--use-file-for-fake-audio-capture=C:/Users/Rog/Workspace/01_PROYECTOS/piano-game/tmp_test/julian-piano.wav',
      '--fake-device-playback-time=35440']
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto('https://juliangdeveloper.github.io/piano-game/', { waitUntil: 'networkidle' });
  await page.click('#btnSettings'); await page.click('#btnSettings');
  await page.click('#btnToggle');
  await page.waitForTimeout(8000);
  await page.screenshot({ path: 'e2e-v163-mid.png' });
  const display = await page.locator('#noteDisplay').textContent();
  const noteDb = await page.locator('#noteDb').textContent();
  const version = await page.locator('#version').textContent();
  console.log(JSON.stringify({ display, noteDb, version }));
  await browser.close();
})();
