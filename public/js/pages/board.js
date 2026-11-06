// Tablero Kanban (RF-63): arrastrar y soltar tarjetas entre columnas de estado.
// Solo escribe texto con textContent y usa el endpoint POST /api/v1/tasks/:id/status.
(() => {
  const board = document.querySelector('[data-board]');
  if (!board) return;
  const live = document.getElementById('board-status');
  let dragged = null;

  const say = (message) => {
    if (live) live.textContent = message;
  };

  function refreshColumn(column) {
    const cards = column.querySelectorAll('[data-task-id]');
    let points = 0;
    for (const card of cards) points += Number(card.dataset.points || 0);
    const count = column.querySelector('[data-count]');
    const total = column.querySelector('[data-points-total]');
    if (count) count.textContent = String(cards.length);
    if (total) total.textContent = String(points);
  }

  board.addEventListener('dragstart', (event) => {
    const card = event.target.closest('[data-task-id]');
    if (!card || card.dataset.canMove !== 'true') {
      event.preventDefault();
      return;
    }
    dragged = card;
    event.dataTransfer.setData('text/plain', card.dataset.taskId);
    event.dataTransfer.effectAllowed = 'move';
    card.classList.add('opacity-50');
  });

  board.addEventListener('dragend', () => {
    if (dragged) dragged.classList.remove('opacity-50');
    dragged = null;
    for (const col of board.querySelectorAll('[data-status]')) col.classList.remove('ring-2');
  });

  board.addEventListener('dragover', (event) => {
    const column = event.target.closest('[data-status]');
    if (!dragged || !column) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    column.classList.add('ring-2');
  });

  board.addEventListener('dragleave', (event) => {
    const column = event.target.closest('[data-status]');
    if (column && !column.contains(event.relatedTarget)) column.classList.remove('ring-2');
  });

  board.addEventListener('drop', async (event) => {
    const column = event.target.closest('[data-status]');
    if (!dragged || !column) return;
    event.preventDefault();
    const card = dragged;
    const target = column.dataset.status;
    const source = card.closest('[data-status]');
    if (source === column) return;

    const list = column.querySelector('[data-cards]');
    const previous = card.nextElementSibling;
    list.append(card);
    refreshColumn(column);
    refreshColumn(source);
    try {
      const response = await fetch(`/api/v1/tasks/${card.dataset.taskId}/status`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: target }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error?.message || 'No se pudo mover la tarea');
      }
      say(`Tarea movida a ${column.dataset.label}`);
    } catch (error) {
      // Revierte la tarjeta a su columna de origen.
      source.querySelector('[data-cards]').insertBefore(card, previous);
      refreshColumn(column);
      refreshColumn(source);
      say(error.message);
    }
  });
})();
