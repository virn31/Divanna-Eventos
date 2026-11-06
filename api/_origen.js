// api/_origen.js
// Columna Origen de EVENTOS (selección única): quién creó cada evento.
// Víctor 2026-11-06: "DiMa", "Formulario" o el nombre de quien lo capturó en la
// app (Diana, Eden, Mario, Ángela...). Antes los capturados decían "Manual".
// Módulo sin dependencias para que lo usen pedidos, calendario y el balance
// sin crear requires circulares.

const ORIGENES = { CHAT: 'DiMa', FORMULARIO: 'Formulario', MANUAL: 'Manual' };

// Primer nombre de quien captura (así se lee en el balance: "Diana", "Eden").
function origenDePersona(nombre) {
  const primero = String(nombre || '').trim().split(/\s+/)[0] || '';
  return primero ? primero.charAt(0).toUpperCase() + primero.slice(1) : ORIGENES.MANUAL;
}

// Origen de un evento: la columna si ya la tiene; si no (eventos de antes de
// la columna), se deduce del primer renglón de Notas que pone cada camino.
// Los valores viejos se leen con el nombre nuevo ("Chat DiMa" → "DiMa",
// "Manual" → quien lo capturó, si Notas lo dice).
function origenDeEvento(fields = {}) {
  const notas = String(fields.Notas || '');
  const capturo = /^Evento capturado a mano por (\S+)/.exec(notas);
  if (fields.Origen === 'Chat DiMa') return ORIGENES.CHAT;
  if (fields.Origen && fields.Origen !== ORIGENES.MANUAL) return fields.Origen;
  if (capturo) return origenDePersona(capturo[1]);
  if (fields.Origen) return fields.Origen;
  if (notas.startsWith('Pedido armado con DiMa')) return ORIGENES.CHAT;
  if (notas.startsWith('Pedido desde el formulario')) return ORIGENES.FORMULARIO;
  if (notas.startsWith('Evento capturado a mano')) return ORIGENES.MANUAL;
  return 'Sin dato';
}

module.exports = { ORIGENES, origenDeEvento, origenDePersona };
