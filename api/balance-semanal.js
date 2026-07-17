// api/balance-semanal.js
// Se ejecuta automáticamente cada lunes (via Vercel Cron, ver vercel.json)
// y también se puede llamar manualmente para pruebas.
// Calcula el balance de la semana que acaba de terminar (lunes a domingo)
// y le manda el resumen a Diana (y a Víctor) por WhatsApp.
//
// NOTA IMPORTANTE sobre "Ingresos": no existe todavía una tabla de ingresos
// reales cobrados, así que usamos como aproximación la suma de
// Monto_Estimado_IA de los eventos AUTORIZADOS por Diana (Autorizacion_Diana=SI)
// cuya Fecha_Evento cae dentro de la semana -- esto es el monto CONTRATADO,
// no necesariamente lo que ya se cobró en efectivo. Se le avisa a Diana que
// es un estimado, no una cifra contable exacta.

const AIRTABLE_BASE_ID = 'appkpCfDADzQJ5G9H';
const TABLES = {
  EVENTOS: 'tblzLAin65BZPP2c6',
  GASTOS: 'tblfuEW0oiX4xTw7T',
  BALANCES: 'tblRJYJHhHzyKcaWH',
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

async function enviarWhatsApp(numeroDestino, mensaje) {
  if (!numeroDestino) {
    console.error('enviarWhatsApp: no se recibió numeroDestino (revisa DIANA_WHATSAPP_NUMBER / VICTOR_WHATSAPP_NUMBER en Vercel)');
    return;
  }
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM;
  if (!sid || !token || !from) {
    console.error('Faltan variables de entorno de Twilio para enviar el balance');
    return;
  }
  const to = numeroDestino.startsWith('whatsapp:') ? numeroDestino : `whatsapp:${numeroDestino}`;
  const body = new URLSearchParams({ From: from, To: to, Body: mensaje });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!res.ok) console.error('Error enviando balance por WhatsApp:', await res.text());
}

// Plantilla aprobada de WhatsApp "balance_semanal", necesaria porque el cron
// corre solo, sin que nadie le haya escrito antes a DiMa (mensaje iniciado
// por el negocio, requiere plantilla aprobada -- ver error 63016).
async function enviarWhatsAppTemplate(numeroDestino, contentSid, variables) {
  if (!numeroDestino) {
    console.error('enviarWhatsAppTemplate: no se recibió numeroDestino');
    return;
  }
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM;
  if (!sid || !token || !from) {
    console.error('Faltan variables de entorno de Twilio para enviar la plantilla del balance');
    return;
  }
  const to = numeroDestino.startsWith('whatsapp:') ? numeroDestino : `whatsapp:${numeroDestino}`;
  const body = new URLSearchParams({
    From: from,
    To: to,
    ContentSid: contentSid,
    ContentVariables: JSON.stringify(variables),
  });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!res.ok) console.error('Error enviando plantilla del balance:', await res.text());
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

    // Gastos de la semana (todas las categorías/negocios juntos)
    const formulaGastos = encodeURIComponent(`AND(IS_AFTER({Fecha}, '${inicioExclusivo}T00:00:00.000Z'), IS_BEFORE({Fecha}, '${finExclusivo}T00:00:00.000Z'))`);
    let gastosTotales = 0;
    let gastosPorNegocio = {};
    try {
      const gastosData = await airtableGet(`${TABLES.GASTOS}?filterByFormula=${formulaGastos}`);
      gastosData.records.forEach(r => {
        const monto = r.fields.Monto || 0;
        gastosTotales += monto;
        const negocio = r.fields.Negocio || 'Sin especificar';
        gastosPorNegocio[negocio] = (gastosPorNegocio[negocio] || 0) + monto;
      });
    } catch (e) {
      console.error('Error calculando gastos de la semana:', e.message);
    }

    // Ingresos aproximados: eventos autorizados por Diana con fecha en la semana
    const formulaEventos = encodeURIComponent(`AND({Autorizacion_Diana}='SI', IS_AFTER({Fecha_Evento}, '${inicioExclusivo}T00:00:00.000Z'), IS_BEFORE({Fecha_Evento}, '${finExclusivo}T00:00:00.000Z'))`);
    let ingresosTotales = 0;
    let ingresosPorNegocio = {};
    let numEventos = 0;
    try {
      const eventosData = await airtableGet(`${TABLES.EVENTOS}?filterByFormula=${formulaEventos}`);
      numEventos = eventosData.records.length;
      eventosData.records.forEach(r => {
        const monto = r.fields.Monto_Estimado_IA || 0;
        ingresosTotales += monto;
        const negocio = r.fields.Negocio || 'Sin especificar';
        ingresosPorNegocio[negocio] = (ingresosPorNegocio[negocio] || 0) + monto;
      });
    } catch (e) {
      console.error('Error calculando ingresos de la semana:', e.message);
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
      `📈 Utilidad neta aproximada: $${utilidad.toLocaleString('es-MX')}\n\n` +
      `Nota: los ingresos son el monto contratado de eventos autorizados, no necesariamente lo ya cobrado en efectivo. Los gastos dependen de que se hayan registrado en la tabla GASTOS. ¡Que tengas excelente semana! 💜`;

    await airtablePost(TABLES.BALANCES, {
      Nombre_Periodo: `Semana ${inicio} a ${fin}`,
      Fecha_Inicio: inicio,
      Fecha_Fin: fin,
      Ingresos_Totales: ingresosTotales,
      Gastos_Totales: gastosTotales,
      Enviado_WhatsApp: true,
      Detalle_Completo: detalleCompleto,
      Detalle_Enviado: false,
    });

    // Plantilla aprobada "balance_semanal": "Balance semanal ({{1}} a {{2}}):
    // Ingresos ${{3}}, Gastos ${{4}}, Utilidad ${{5}}."
    const CONTENT_SID_BALANCE = 'HXf97a1f85e6ff9cf1a20367d434c78b86';
    const variables = {
      '1': inicio,
      '2': fin,
      '3': ingresosTotales.toLocaleString('es-MX'),
      '4': gastosTotales.toLocaleString('es-MX'),
      '5': utilidad.toLocaleString('es-MX'),
    };

    await Promise.all([
      enviarWhatsAppTemplate(process.env.DIANA_WHATSAPP_NUMBER, CONTENT_SID_BALANCE, variables),
      enviarWhatsAppTemplate(process.env.VICTOR_WHATSAPP_NUMBER, CONTENT_SID_BALANCE, variables),
    ]);

    res.status(200).json({ success: true, inicio, fin, ingresosTotales, gastosTotales, utilidad });
  } catch (err) {
    console.error('Error en balance-semanal:', err.message);
    res.status(500).json({ error: 'Error interno generando el balance' });
  }
};
