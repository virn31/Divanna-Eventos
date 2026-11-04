// api/_origen.js
// Columna Origen de EVENTOS (selección única): de dónde llegó cada evento.
// Módulo sin dependencias para que lo usen pedidos, calendario y el balance
// sin crear requires circulares.

const ORIGENES = { CHAT: 'Chat DiMa', FORMULARIO: 'Formulario', MANUAL: 'Manual' };

// Origen de un evento: la columna si ya la tiene; si no (eventos de antes de
// la columna), se deduce del primer renglón de Notas que pone cada camino.
function origenDeEvento(fields = {}) {
  if (fields.Origen) return fields.Origen;
  const notas = String(fields.Notas || '');
  if (notas.startsWith('Pedido armado con DiMa')) return ORIGENES.CHAT;
  if (notas.startsWith('Pedido desde el formulario')) return ORIGENES.FORMULARIO;
  if (notas.startsWith('Evento capturado a mano')) return ORIGENES.MANUAL;
  return 'Sin dato';
}

module.exports = { ORIGENES, origenDeEvento };
