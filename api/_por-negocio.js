// api/_por-negocio.js
// Cuánto gasta y cuánto gana cada negocio (Víctor 2026-11-10): Divanna Eventos,
// Casa Isabella y El Vaso Maíz, más el balance general. Lo usan el balance
// semanal (api/balance-semanal.js), el historial de Finanzas del dashboard
// (historialMensual en api/_finanzas.js) y el buenos días diario (api/_cuadre.js).
//
// Reglas:
// - Ingresos = lo contratado (Monto_Estimado_IA) de eventos autorizados. Un evento
//   con el salón cuenta completo para Casa Isabella (misma regla que la gerencia de
//   Mario, eleccionDeEvento en api/_sesion.js).
// - Gastos y cobros: el negocio que se eligió al anotarlos. Casa Isabella se
//   guarda como Negocio = Divanna Eventos + casilla Casa_Isabella; lo anotado
//   antes del 2026-11-10 no tiene la casilla y cuenta en Divanna.
// - Utilidad = ingresos − gastos (aproximada: ingresos contratados, no cobrados).

const { eleccionDeEvento, usaCasaIsabella } = require('./_sesion');

const NEGOCIOS = ['Divanna Eventos', 'Casa Isabella', 'El Vaso Maiz'];
const NOMBRE = { 'Divanna Eventos': 'Divanna Eventos', 'Casa Isabella': 'Casa Isabella', 'El Vaso Maiz': 'El Vaso Maíz' };
const ICONO = { 'Divanna Eventos': '🪑', 'Casa Isabella': '🏛️', 'El Vaso Maiz': '🌽' };

const pesos = (n) => `$${Math.round(Number(n) || 0).toLocaleString('es-MX')}`;
const vacio = () => ({ eventos: 0, ingresos: 0, gastos: 0, cobrado: 0 });

// Negocio de un evento para reportes, o null si no tiene negocio claro.
function negocioDeEvento(f) {
  const x = f || {};
  if (!x.Negocio && !(Number(x.Piezas_Vaso_Maiz) > 0) && !usaCasaIsabella(x)) return null;
  return eleccionDeEvento(x);
}

// Negocio de un gasto o cobro, o null si no lo tiene.
function negocioDeMovimiento(f) {
  const x = f || {};
  if (x.Casa_Isabella) return 'Casa Isabella';
  return x.Negocio === 'Divanna Eventos' || x.Negocio === 'El Vaso Maiz' ? x.Negocio : null;
}

// Tabla { 'Divanna Eventos': {...}, 'Casa Isabella': {...}, 'El Vaso Maiz': {...}, general: {...}, sinNegocio: {...} }
// eventos, gastos y cobros son registros de Airtable (ya filtrados por periodo y aprobación).
function resumir({ eventos = [], gastos = [], cobros = [] }) {
  const t = { general: vacio(), sinNegocio: vacio() };
  NEGOCIOS.forEach(n => { t[n] = vacio(); });
  const caja = (n) => t[n] || t.sinNegocio;
  for (const r of eventos) {
    const f = r.fields || {};
    if (f.Cancelado) continue;
    const c = caja(negocioDeEvento(f));
    const monto = Number(f.Monto_Estimado_IA) || 0;
    c.eventos++; c.ingresos += monto;
    t.general.eventos++; t.general.ingresos += monto;
  }
  for (const r of gastos) {
    const monto = Number((r.fields || {}).Monto) || 0;
    caja(negocioDeMovimiento(r.fields)).gastos += monto;
    t.general.gastos += monto;
  }
  for (const r of cobros) {
    const monto = Number((r.fields || {}).Monto) || 0;
    caja(negocioDeMovimiento(r.fields)).cobrado += monto;
    t.general.cobrado += monto;
  }
  Object.values(t).forEach(c => {
    ['ingresos', 'gastos', 'cobrado'].forEach(k => { c[k] = Math.round(c[k] * 100) / 100; });
    c.utilidad = Math.round((c.ingresos - c.gastos) * 100) / 100;
  });
  return t;
}

const hayAlgo = (c) => c.eventos || c.ingresos || c.gastos || c.cobrado;

// Texto para Telegram/correo: un renglón por negocio y el general.
function textoResumen(t, { titulo = '🏢 Por negocio', conCobrado = true } = {}) {
  const renglon = (c) => `ingresos ${pesos(c.ingresos)} (${c.eventos} evento${c.eventos === 1 ? '' : 's'}) · gastos ${pesos(c.gastos)} · utilidad ${pesos(c.utilidad)}${conCobrado ? ` · cobrado ${pesos(c.cobrado)}` : ''}`;
  const lineas = NEGOCIOS.map(n => `${ICONO[n]} ${NOMBRE[n]}: ${renglon(t[n])}`);
  if (hayAlgo(t.sinNegocio)) lineas.push(`❔ Sin negocio: ${renglon(t.sinNegocio)}`);
  lineas.push(`📊 General: ${renglon(t.general)}`);
  return `${titulo}:\n${lineas.map(l => `  ${l}`).join('\n')}`;
}

module.exports = { NEGOCIOS, NOMBRE, ICONO, negocioDeEvento, negocioDeMovimiento, resumir, textoResumen, vacio };
