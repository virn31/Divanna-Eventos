// brigadas/buscar-producto.js
// Buscador en cada renglón de producto (Víctor 2026-11-06: "teclear mesita y que
// me lleve a la mesita de herrería"). Lo usan el ➕ Capturar evento del
// calendario y "Hora y productos" del dashboard. Basta con poner en el renglón un
// <input data-buscar-producto> junto a su <select>: al escribir se esconden las
// opciones que no coinciden (sin importar acentos ni mayúsculas) y se elige la
// primera que sí.
(function(){
  const normal = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  function filtrar(input){
    const fila = input.parentElement;
    const select = fila && fila.querySelector('select');
    if (!select) return;
    const palabras = normal(input.value).split(/\s+/).filter(Boolean);
    let primera = null;
    for (const op of select.options) {
      if (!op.value) { op.hidden = false; continue; }
      const coincide = palabras.every(p => normal(op.text).includes(p));
      op.hidden = !coincide;
      if (coincide && !primera) primera = op;
    }
    for (const g of select.querySelectorAll('optgroup')) g.hidden = ![...g.children].some(op => !op.hidden);
    input.classList.toggle('sin-resultado', !!palabras.length && !primera);
    if (primera && select.value !== primera.value) {
      select.value = primera.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  document.addEventListener('input', (e) => {
    if (e.target && e.target.matches && e.target.matches('[data-buscar-producto]')) filtrar(e.target);
  });
  window.DimaBuscarProducto = { filtrar, normal };
})();
