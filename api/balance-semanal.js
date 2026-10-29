// api/balance-semanal.js
// Se ejecuta automáticamente cada lunes (via Vercel Cron, ver vercel.json)
// y también se puede llamar manualmente para pruebas.
// Calcula el balance de la semana que acaba de terminar (lunes a domingo)
// y le manda el resumen a Diana (y a Víctor) por correo. También queda en
// BALANCES y se ve en el dashboard.
//
// NOTA IMPORTANTE sobre "Ingresos": no existe todavía una tabla de ingresos
// reales cobrados, así que usamos como aproximación la suma de
// Monto_Estimado_IA de los eventos AUTORIZADOS por Diana (Autorizacion_Diana=SI)
// cuya Fecha_Evento cae dentro de la semana -- esto es el monto CONTRATADO,
// no necesariamente lo que ya se cobró en efectivo. Se le avisa a Diana que
// es un estimado, no una cifra contable exacta.

const { enviarCorreoEquipo } = require('./_google-integrations');
const { enviarTelegramEquipo } = require('./_telegram');
const { ROLES } = require('./_sesion');
const { calcularPorCobrar } = require('./_finanzas');

const AIRTABLE_BASE_ID = 'appkpCfDADzQJ5G9H';
const TABLES = {
  EVENTOS: 'tblzLAin65BZPP2c6',
  GASTOS: 'tblfuEW0oiX4xTw7T',
  BALANCES: 'tblRJYJHhHzyKcaWH',
  REPORTES: 'tbllUK2N9ZDv2Bpdt',
  COBROS: 'tblb8ADFukpm6nRZV',
};

async function airtableGet(path) {
  const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${path}`, {
    headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Airtable GET error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function airtablePost(tableId, fields) {
  const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${tableId}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ records: [{ fields }] }),
  });
  if (!res.ok) throw new Error(`Airtable POST error ${res.status}: ${await res.text()}`);
  return res.json();
}

// Devuelve el lunes y domingo de la semana que ACABA de terminar
// (si hoy es lunes, reporta la semana pasada, lunes a domingo).
function semanaAnterior() {
  const hoy = new Date();
  const diaSemana = hoy.getDay(); // 0=domingo, 1=lunes...
  const diasHastaLunesActual = diaSemana === 0 ? 6 : diaSemana - 1;
  const lunesActual = new Date(hoy);
  lunesActual.setDate(hoy.getDate() - diasHastaLunesActual);

  const lunesPasado = new Date(lunesActual);
  lunesPasado.setDate(lunesActual.getDate() - 7);
  const domingoAntesDeInicio = new Date(lunesPasado);
  domingoAntesDeInicio.setDate(lunesPasado.getDate() - 1); // día antes del inicio, para límite exclusivo
  const domingoPasado = new Date(lunesActual);
  domingoPasado.setDate(lunesActual.getDate() - 1);
  const lunesSiguiente = new Date(lunesActual); // = domingoPasado + 1 día, límite exclusivo

  const fmt = (d) => d.toISOString().split('T')[0];
  return { inicio: fmt(lunesPasado), fin: fmt(domingoPasado), finExclusivo: fmt(lunesSiguiente), inicioExclusivo: fmt(domingoAntesDeInicio) };
}

module.exports = async (req, res) => {
  try {
    // Protección simple: solo Vercel Cron o alguien con el secreto puede disparar esto.
    const authHeader = req.headers['authorization'];
    const esCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
    const esManual = req.query && req.query.secreto === process.env.CRON_SECRET;
    if (process.env.CRON_SECRET && !esCron && !esManual) {
      res.status(401).json({ error: 'No autorizado' });
      return;
    }

    const { inicio, fin, finExclusivo, inicioExclusivo } = semanaAnterior();

    // Reportes del día aprobados por Diana en la semana (fase 3): solo sus
    // gastos y cobros cuentan; lo que sigue sin aprobar se avisa aparte.
    const rango = (campo) => `AND(IS_AFTER({${campo}}, '${inicioExclusivo}T00:00:00.000Z'), IS_BEFORE({${campo}}, '${finExclusivo}T00:00:00.000Z'))`;
    const avisosLectura = [];
    let aprobados = new Set();
    let efectivoEntregado = 0;
    try {
      const reportes = await airtableGet(`${TABLES.REPORTES}?filterByFormula=${encodeURIComponent(`AND({Estado} = 'Aprobado', ${rango('Fecha')})`)}`);
      aprobados = new Set(reportes.records.map(r => r.id));
      reportes.records.forEach(r => { efectivoEntregado += r.fields.Efectivo_Entregado || 0; });
    } catch (e) {
      console.error('Error leyendo reportes del día:', e.message);
      avisosLectura.push('No se pudieron leer los reportes del día: los gastos de las brigadas no están incluidos.');
    }

    // Gastos de la semana (todas las categorías/negocios juntos). Los capturados
    // a mano (sin reporte) cuentan siempre; los de un reporte, solo si está aprobado.
    let gastosTotales = 0;
    let gastosPorNegocio = {};
    let sinAprobar = 0, montoSinAprobar = 0, reembolsosPendientes = 0;
    try {
      const gastosData = await airtableGet(`${TABLES.GASTOS}?filterByFormula=${encodeURIComponent(rango('Fecha'))}`);
      gastosData.records.forEach(r => {
        const monto = r.fields.Monto || 0;
        const reporte = (r.fields.Reporte || [])[0];
        if (reporte && !aprobados.has(reporte)) { sinAprobar++; montoSinAprobar += monto; return; }
        gastosTotales += monto;
        const negocio = r.fields.Negocio || 'Sin especificar';
        gastosPorNegocio[negocio] = (gastosPorNegocio[negocio] || 0) + monto;
        if (r.fields.Pagado_Con === 'Dinero propio' && !r.fields.Reembolsado) reembolsosPendientes += monto;
      });
    } catch (e) {
      console.error('Error calculando gastos de la semana:', e.message);
      avisosLectura.push('No se pudieron leer los gastos: el total de gastos NO es real.');
    }

    // Cobros reales que reportaron las brigadas (reportes aprobados).
    let cobrosTotales = 0;
    const cobrosPorForma = {};
    let cobrosRegistros = [];
    try {
      const cobrosData = await airtableGet(`${TABLES.COBROS}?filterByFormula=${encodeURIComponent(rango('Fecha'))}`);
      cobrosRegistros = cobrosData.records;
      cobrosData.records.forEach(r => {
        if (!aprobados.has((r.fields.Reporte || [])[0])) return;
        const monto = r.fields.Monto || 0;
        cobrosTotales += monto;
        const forma = r.fields.Forma || 'Sin especificar';
        cobrosPorForma[forma] = (cobrosPorForma[forma] || 0) + monto;
      });
    } catch (e) {
      console.error('Error leyendo cobros de la semana:', e.message);
      avisosLectura.push('No se pudieron leer los cobros de las brigadas.');
    }

    // Ingresos aproximados: eventos autorizados por Diana con fecha en la semana
    const formulaEventos = encodeURIComponent(`AND({Autorizacion_Diana}='SI', IS_AFTER({Fecha_Evento}, '${inicioExclusivo}T00:00:00.000Z'), IS_BEFORE({Fecha_Evento}, '${finExclusivo}T00:00:00.000Z'))`);
    let ingresosTotales = 0;
    let ingresosPorNegocio = {};
    let numEventos = 0;
    let porCobrar = null; // null = no se pudo calcular (se dice en el texto)
    try {
      const eventosData = await airtableGet(`${TABLES.EVENTOS}?filterByFormula=${formulaEventos}`);
      numEventos = eventosData.records.length;
      // Lo que todavía deben los clientes de los eventos de la semana.
      porCobrar = calcularPorCobrar(eventosData.records, cobrosRegistros, aprobados);
      eventosData.records.forEach(r => {
        const monto = r.fields.Monto_Estimado_IA || 0;
        ingresosTotales += monto;
        const negocio = r.fields.Negocio || 'Sin especificar';
        ingresosPorNegocio[negocio] = (ingresosPorNegocio[negocio] || 0) + monto;
      });
    } catch (e) {
      console.error('Error calculando ingresos de la semana:', e.message);
      avisosLectura.push('No se pudieron leer los eventos: los ingresos y lo por cobrar NO son reales.');
    }

    const utilidad = ingresosTotales - gastosTotales;

    // Guardar el registro en BALANCES (sin tocar Periodo/Negocio para evitar
    // errores de opciones de singleSelect que no conocemos de antemano).
    const desglose = (obj) => Object.entries(obj).map(([k, v]) => `  ${k}: $${v.toLocaleString('es-MX')}`).join('\n') || '  (sin registros)';

    const detalleCompleto =
      `📊 Aquí está tu balance semanal completo (${inicio} a ${fin}):\n\n` +
      `💰 Ingresos aproximados (eventos autorizados esta semana, ${numEventos} evento${numEventos === 1 ? '' : 's'}):\n${desglose(ingresosPorNegocio)}\n` +
      `Total ingresos: $${ingresosTotales.toLocaleString('es-MX')}\n\n` +
      `💸 Gastos registrados:\n${desglose(gastosPorNegocio)}\n` +
      `Total gastos: $${gastosTotales.toLocaleString('es-MX')}\n\n` +
      `💵 Cobrado por las brigadas (reportes aprobados):\n${desglose(cobrosPorForma)}\n` +
      `Total cobrado: $${cobrosTotales.toLocaleString('es-MX')} · efectivo entregado a Diana: $${efectivoEntregado.toLocaleString('es-MX')}\n\n` +
      (porCobrar ? `🫒 Por cobrar a clientes (eventos de la semana): $${porCobrar.total.toLocaleString('es-MX')}${porCobrar.eventos ? ` en ${porCobrar.eventos} evento${porCobrar.eventos === 1 ? '' : 's'}` : ''}\n\n` : '') +
      (reembolsosPendientes ? `🔁 Reembolsos pendientes (gastos con dinero propio): $${reembolsosPendientes.toLocaleString('es-MX')}\n\n` : '') +
      (sinAprobar ? `⏳ ${sinAprobar} gasto${sinAprobar === 1 ? '' : 's'} ($${montoSinAprobar.toLocaleString('es-MX')}) en reportes sin aprobar: no cuentan todavía.\n\n` : '') +
      (avisosLectura.length ? `⚠️ ${avisosLectura.join(' ')}\n\n` : '') +
      `📈 Utilidad neta aproximada: $${utilidad.toLocaleString('es-MX')}\n\n` +
      `Nota: los ingresos son el monto contratado de eventos autorizados, no necesariamente lo ya cobrado en efectivo. Los gastos dependen de que se hayan registrado en la tabla GASTOS. ¡Que tengas excelente semana! 💜`;

    const [correoEnviado] = await Promise.all([
      enviarCorreoEquipo({ asunto: `📊 Balance semanal ${inicio} a ${fin}`, texto: detalleCompleto }),
      enviarTelegramEquipo({ roles: [ROLES.ADMIN], texto: detalleCompleto }),
    ]);

    // Enviado_WhatsApp queda en false: el campo es histórico de cuando el
    // balance salía por WhatsApp. Detalle_Enviado indica si llegó el correo.
    await airtablePost(TABLES.BALANCES, {
      Nombre_Periodo: `Semana ${inicio} a ${fin}`,
      Fecha_Inicio: inicio,
      Fecha_Fin: fin,
      Ingresos_Totales: ingresosTotales,
      Gastos_Totales: gastosTotales,
      ...(porCobrar ? { Por_Cobrar: porCobrar.total } : {}),
      Detalle_Completo: detalleCompleto,
      Detalle_Enviado: correoEnviado,
    });

    res.status(200).json({ success: true, inicio, fin, ingresosTotales, gastosTotales, utilidad, correoEnviado });
  } catch (err) {
    console.error('Error en balance-semanal:', err.message);
    res.status(500).json({ error: 'Error interno generando el balance' });
  }
};
