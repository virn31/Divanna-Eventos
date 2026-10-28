// api/_temporada.js
// Temporada alta de fin de año: una semana antes de Navidad y hasta entrando
// el año. En esas fechas los precios suben 70% y no se manejan los paquetes
// regulares (decisión de Víctor, por la demanda de trabajo). Cuenta la fecha
// del EVENTO, no la del día en que el cliente escribe.

const TEMPORADA_ALTA = {
  desde: { mes: 12, dia: 18 }, // una semana antes de Navidad
  hasta: { mes: 1, dia: 1 },   // hasta el 1 de enero inclusive (confirmado por Víctor)
  aumento: 0.70,
};

// fecha: 'YYYY-MM-DD'. ¿Cae dentro de la temporada alta?
function enTemporadaAlta(fecha) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(fecha || ''));
  if (!m) return false;
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  const { desde, hasta } = TEMPORADA_ALTA;
  const despuesDelInicio = mes === desde.mes && dia >= desde.dia;
  const antesDelFin = mes === hasta.mes && dia <= hasta.dia;
  return despuesDelInicio || antesDelFin;
}

function textoTemporada() {
  const { desde, hasta, aumento } = TEMPORADA_ALTA;
  const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  return `del ${desde.dia} de ${meses[desde.mes - 1]} al ${hasta.dia} de ${meses[hasta.mes - 1]}, +${Math.round(aumento * 100)}%`;
}

module.exports = { TEMPORADA_ALTA, enTemporadaAlta, textoTemporada };
