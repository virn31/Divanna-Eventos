// api/_colores.js
// Nota de colores por definir en EVENTOS.Instrucciones_Equipo (Víctor 2026-11-09):
// si el cliente cierra sin definir mantel, copa o plato base, queda una línea
// "PENDIENTE COLORES:" que el equipo ve en la app y en Telegram; cuando el
// cliente los confirma, esa línea se reemplaza por el color definido. Los
// manteles corrugados y de lentejuela dejan además "PROVEEDOR EXTERNO:".
// Sin dependencias: lo usan _pedidos.js y las pruebas.

const PREFIJO_PENDIENTE = 'PENDIENTE COLORES:';
const PREFIJO_DEFINIDOS = 'COLORES DEFINIDOS:';
const PREFIJO_PROVEEDOR = 'PROVEEDOR EXTERNO:';

const lineaPendiente = (falta, cliente) =>
  `${PREFIJO_PENDIENTE} falta definir ${falta}. El encargado lo coordina con el cliente${cliente ? ' ' + cliente : ''}.`;
const lineaProveedor = (detalle) =>
  `${PREFIJO_PROVEEDOR} pedir ${detalle}. DiMa no confirmó disponibilidad; el gerente lo confirma con el proveedor.`;

// Devuelve el texto nuevo de Instrucciones_Equipo. Sin datos, lo deja igual.
function actualizarNotaColores(actual, { pendientes, definidos, proveedor, cliente } = {}) {
  let lineas = String(actual || '').split('\n').filter(Boolean);
  if (definidos) {
    lineas = lineas.filter(l => !l.startsWith(PREFIJO_PENDIENTE) && !l.startsWith(PREFIJO_DEFINIDOS));
    lineas.push(`${PREFIJO_DEFINIDOS} ${definidos}`);
  }
  if (pendientes) {
    lineas = lineas.filter(l => !l.startsWith(PREFIJO_PENDIENTE));
    lineas.push(lineaPendiente(pendientes, cliente));
  }
  if (proveedor && !lineas.includes(lineaProveedor(proveedor))) lineas.push(lineaProveedor(proveedor));
  return lineas.join('\n');
}

module.exports = { PREFIJO_PENDIENTE, PREFIJO_DEFINIDOS, PREFIJO_PROVEEDOR, actualizarNotaColores, lineaPendiente, lineaProveedor };
