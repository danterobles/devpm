// Imprime los dos manuales a PDF (carta horizontal, márgenes de 0.6 in arriba/abajo y 0.75 in a los lados).
// Requiere el servidor estático de .playwright-mcp:  python3 -m http.server 8765 --directory .playwright-mcp
async (page) => {
  for (const name of ['Manual-Usuario', 'Manual-Administrador']) {
    await page.goto('http://localhost:8765/' + name + '.html', { waitUntil: 'load' });
    await page.pdf({
      path: '__ROOT__/docs/manuales/' + name + '.pdf',
      format: 'Letter', landscape: true, printBackground: true,
      margin: { top: '0.6in', bottom: '0.6in', left: '0.75in', right: '0.75in' },
      displayHeaderFooter: true, headerTemplate: '<span></span>',
      footerTemplate: '<div style="width:100%;font-size:8px;color:#64748b;padding:0 0.75in;display:flex;justify-content:space-between;font-family:Arial"><span>DevPM · ' + name.replace(/-/g, ' ') + '</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
    });
  }
  return 'ok';
}
