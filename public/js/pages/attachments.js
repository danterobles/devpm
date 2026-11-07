// Adjuntos de la tarea (RF-140): envía el archivo como cuerpo binario a
// POST /api/v1/tasks/:id/attachments?name=… y recarga la sección. Solo escribe con textContent.
(() => {
  const section = document.querySelector('[data-attachments]');
  const input = section?.querySelector('[data-attachment-input]');
  if (!section || !input) return;
  const message = section.querySelector('[data-attachment-message]');
  const maxBytes = Number(section.dataset.maxBytes);

  const say = (text, isError = false) => {
    message.textContent = text;
    message.className = `mt-1 text-sm ${isError ? 'text-red-700' : 'text-green-800'}`;
  };

  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > maxBytes) {
      say(`El archivo supera ${Math.round(maxBytes / 1048576)} MB.`, true);
      input.value = '';
      return;
    }
    say('Subiendo…');
    try {
      const response = await fetch(
        `/api/v1/tasks/${section.dataset.taskId}/attachments?name=${encodeURIComponent(file.name)}`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: file,
        },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        say(
          body?.error?.details?.[0]?.message ||
            body?.error?.message ||
            'No se pudo subir el archivo',
          true,
        );
        input.value = '';
        return;
      }
      window.location.hash = 'adjuntos';
      window.location.reload();
    } catch {
      say('Sin conexión: no se pudo subir el archivo.', true);
    }
  });
})();
