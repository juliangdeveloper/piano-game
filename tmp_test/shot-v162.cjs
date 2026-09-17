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
  await page.waitForTimeout(40000);
  await page.screenshot({ path: 'e2e-v162.png' });
  const freq = await page.locator('#freqText').textContent();
  console.log(JSON.stringify({ freq }));
  await browser.close();
})();
