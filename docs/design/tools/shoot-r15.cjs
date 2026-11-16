// ถ่ายภาพหน้าตัวอย่าง R15a + ตรวจล้นแนวนอน/เป้าแตะ < 44px (พิมพ์ผลต่อภาพ) — ใช้ playwright ของ repo
// ใช้: node docs/design/tools/shoot-r15.cjs <repoRoot> <outDir> state,width,lang,theme[,full|view[,ชื่อไฟล์ตัวอย่างไม่มี .html]] ...
// ตัวอย่าง: node docs/design/tools/shoot-r15.cjs . docs/design/screenshots/r15a picker,375,th,light skip,390,en,dark
// (โฟลเดอร์ docs/design/screenshots/ อยู่ใน .gitignore — สร้างใหม่ได้เสมอ)
const path = require('path');
const root0 = process.argv[2];
const { chromium } = require(path.join(root0, 'node_modules', 'playwright'));
(async () => {
  const out = process.argv[3];
  const jobs = process.argv.slice(4);
  const b = await chromium.launch();
  for (const j of jobs) {
    const [state, w, lang, theme, full, page] = j.split(',');
    const ctx = await b.newContext({ viewport: { width: +w, height: +w >= 768 ? 1024 : 812 }, deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    const file = page || 'r15-feedback';
    const url = 'file:///' + root0.split(path.sep).join('/') + '/docs/design/samples/' + file + '.html?state=' + state + '&lang=' + lang + '&theme=' + theme;
    await p.goto(url);
    await p.waitForTimeout(400);
    const f = path.join(out, file + '-' + state + '-' + w + '-' + lang + '-' + theme + '.png');
    await p.screenshot({ path: f, fullPage: full === 'full' });
    const r = await p.evaluate(() => {
      const small = [...document.querySelectorAll('button, a.row, .gi-opt, .sk-day, a.btn')].filter((e) => {
        const b = e.getBoundingClientRect();
        return e.offsetParent && b.width > 0 && (b.height < 43.5 || b.width < 43.5);
      }).map((e) => (e.className || e.tagName) + ':' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height)).slice(0, 6);
      return { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, small };
    });
    console.log(path.basename(f), JSON.stringify(r));
    await ctx.close();
  }
  await b.close();
})();
