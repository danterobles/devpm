// Importación por CSV (RF-120): lee el archivo en el navegador y lo pone en el cuadro de texto
// (así el servidor solo recibe texto, sin carga de archivos). Solo escribe con textContent.
(() => {
  const form = document.querySelector('[data-import]');
  if (!form) return;
  const entity = form.querySelector('[data-import-entity]');
  const projectBox = form.querySelector('[data-import-project]');
  const template = form.querySelector('[data-import-template]');
  const file = form.querySelector('[data-import-file]');
  const text = form.querySelector('[data-import-text]');
  const message = document.getElementById('import-message');
  const MAX_BYTES = 1_000_000;

  function syncEntity() {
    projectBox.hidden = entity.value !== 'tasks';
    template.setAttribute('href', `/import/template/${entity.value}.csv`);
  }
  entity.addEventListener('change', syncEntity);
  syncEntity();

  file.addEventListener('change', async () => {
    const chosen = file.files?.[0];
    if (!chosen) return;
    if (chosen.size > MAX_BYTES) {
      message.textContent = 'El archivo supera 1 MB; divídelo en partes.';
      file.value = '';
      return;
    }
    text.value = await chosen.text();
    message.textContent = `Se cargó «${chosen.name}». Pulsa «Validar» para revisarlo.`;
  });
})();
