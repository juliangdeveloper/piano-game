const { chromium } = require('C:/Users/Rog/AppData/Local/hermes/hermes-agent/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--use-file-for-fake-audio-capture=C:/Users/Rog/Workspace/01_PROYECTOS/piano-game/tmp_test/piano-full.wav',
      '--fake-device-playback-time=25100'
    ]
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto('https://juliangdeveloper.github.io/piano-game/', { waitUntil: 'networkidle' });
  await page.click('#btnSettings'); await page.click('#btnSettings');
  await page.click('#btnToggle');
  await page.waitForTimeout(29000);
  const rows = await page.locator('#noteLog.chrono li').allTextContents();

  // notas únicas detectadas (sin orden) — cubrir rango completo
  const all = new Set();
  for (const r of rows) all.add(r.match(/^#\d+ ([A-G]#?\d)/)[1]);
  // acordes: filas con ♪♪ cuya voz pareja comparta timestamp ±100ms
  const byT = {};
  for (const r of rows) {
    const m = r.match(/· \+([\d.]+)s/);
    if (m) { const t = Math.round(parseFloat(m[1])*10); (byT[t] = byT[t] || []).push(r); }
  }
  const chordPairs = [];
  for (const [t, rs] of Object.entries(byT)) {
    if (rs.length === 2) chordPairs.push(rs.map(r => r.match(/^#\d+ ([A-G]#?\d)/)[1]).sort().join('+'));
  }
  console.log(JSON.stringify({
    totalRows: rows.length,
    notasUnicas: all.size,
    rango: [...all].join(' '),
    chordPairsUnicos: [...new Set(chordPairs)],
    errorCount: errors.length
  }, null, 2));
  await browser.close();
})();
