// Ayudantes de las capturas de los manuales (armar.sh pone en OUT la ruta real del proyecto).
const OUT = '__ROOT__/.playwright-mcp/shots/';
const BASE = 'http://localhost:3456';
const log = [];
async function login(page, email) {
  await page.context().clearCookies();
  await page.goto(BASE + '/login');
  await page.fill('#email', email);
  await page.fill('#password', 'Cambiar123!');
  await Promise.all([page.waitForNavigation(), page.click('button:has-text("Entrar")')]);
}
/** Contorno rojo y círculo numerado sobre cada elemento (`{css, text?, n}`); devuelve los que no encontró. */
async function mark(page, marks) {
  return page.evaluate((marks) => {
    const missing = [];
    for (const m of marks) {
      const list = [...document.querySelectorAll(m.css)];
      const el = m.text ? list.find((e) => e.textContent.includes(m.text)) : list[0];
      if (!el) { missing.push(m.css + (m.text ? ` «${m.text}»` : '')); continue; }
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) { missing.push('sin tamaño: ' + m.css); continue; }
      el.style.outline = '3px solid #e11d48';
      el.style.outlineOffset = '2px';
      const b = document.createElement('div');
      b.className = 'manual-badge';
      b.textContent = String(m.n);
      const x = Math.max(4, Math.min(window.innerWidth - 32, r.left - 14));
      const y = Math.max(4, Math.min(window.innerHeight - 32, r.top - 14));
      b.setAttribute('style', `position:fixed;left:${x}px;top:${y}px;width:26px;height:26px;border-radius:50%;background:#e11d48;color:#fff;font:700 15px/26px sans-serif;text-align:center;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.45);z-index:99999`);
      document.body.append(b);
    }
    return missing;
  }, marks);
}
async function shot(page, name, { url, prep, marks = [], scrollTo, wait = 700 } = {}) {
  try {
    if (url) await page.goto(BASE + url, { waitUntil: 'networkidle' });
    if (prep) await prep(page);
    if (scrollTo) await page.evaluate((s) => { const e = document.querySelector(s); if (e) window.scrollTo(0, e.getBoundingClientRect().top + window.scrollY - 70); }, scrollTo);
    await page.waitForTimeout(wait);
    const missing = await mark(page, marks);
    await page.screenshot({ path: OUT + name + '.png' });
    await page.evaluate(() => document.querySelectorAll('.manual-badge').forEach((b) => b.remove()));
    log.push(missing.length ? `${name}: marcas no encontradas → ${missing.join(' | ')}` : `${name}: ok`);
  } catch (error) {
    log.push(`${name}: ERROR ${error.message.split('\n')[0]}`);
  }
}
