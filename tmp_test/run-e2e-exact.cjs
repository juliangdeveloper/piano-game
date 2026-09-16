const { chromium } = require('C:/Users/Rog/AppData/Local/hermes/hermes-agent/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--use-file-for-fake-audio-capture=C:/Users/Rog/Workspace/01_PROYECTOS/piano-game/tmp_test/piano-full.wav',
      '--fake-device-playback-time=25100'  // una sola pasada, sin loop
    ]
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

  await page.goto('https://juliangdeveloper.github.io/piano-game/', { waitUntil: 'networkidle' });
  await page.click('#btnSettings'); await page.click('#btnSettings');
  await page.click('#btnToggle');
  await page.waitForTimeout(29000); // WAV 25.1s + cola de decay
  const rows = await page.locator('#noteLog.chrono li').allTextContents();
  await page.screenshot({ path: 'e2e-exact.png' });

  // validación: extraer notas en orden (nombre+octava) y comparar con la escala esperada C2..C7
  const seq = rows.map(r => r.match(/^#\d+ ([A-G]#?\d)/)[1]);
  const unique = []; // colapsar repetidos contiguos (extensión de misma nota)
  for (const s of seq) { if (unique[unique.length-1] !== s) unique.push(s); }
  const chordRows = rows.filter(r => r.includes('♪♪'));
  console.log(JSON.stringify({
    rowsCount: rows.length,
    unicasEnOrden: unique.length,
    primeros12: unique.slice(0, 12),
    ultimos8: unique.slice(-8),
    chordCount: chordRows.length,
    chordRows,
    errorCount: errors.length
  }, null, 2));
  await browser.close();
})();
