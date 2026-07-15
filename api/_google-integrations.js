// api/_google-integrations.js
// Integraciones de Google para DiMa OS: agenda automática en Calendar,
// registro de cotizaciones confirmadas en Sheets, y envío opcional de
// la cotización por correo al cliente (solo si dio su email).
//
// Requiere estas variables de entorno en Vercel:
//   GOOGLE_SERVICE_ACCOUNT_EMAIL  -> dima-calendar-sheets@dima-os.iam.gserviceaccount.com
//   GOOGLE_PRIVATE_KEY            -> la private_key del JSON (con \n literales)
//   GOOGLE_CALENDAR_ID            -> ID del calendario compartido
//   GOOGLE_SHEET_ID               -> ID de la hoja de cálculo (de la URL)
//   GMAIL_USER                    -> dima.divanna@gmail.com
//   GMAIL_APP_PASSWORD            -> contraseña de aplicación de Gmail (16 caracteres)

const { google } = require('googleapis');
const nodemailer = require('nodemailer');

function getAuth(scopes) {
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  return new google.auth.JWT(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    privateKey,
    scopes
  );
}

// ---------- GOOGLE CALENDAR ----------
// Crea un evento en el calendario compartido cuando Diana autoriza una cotización.
async function crearEventoCalendar({ folio, negocio, fechaEvento, ubicacion, invitados, servicios, monto }) {
  try {
    const auth = getAuth(['https://www.googleapis.com/auth/calendar']);
    const calendar = google.calendar({ version: 'v3', auth });

    // Fecha_Evento de Airtable viene como 'YYYY-MM-DD'; se agenda como evento de todo el día.
    const fecha = fechaEvento; // ej. '2026-08-15'
    const fechaFin = new Date(fecha);
    fechaFin.setDate(fechaFin.getDate() + 1);
    const fechaFinStr = fechaFin.toISOString().split('T')[0];

    const evento = {
      summary: `${negocio} - ${folio}${ubicacion ? ' - ' + ubicacion : ''}`,
      description:
        `Folio: ${folio}\n` +
        `Negocio: ${negocio}\n` +
        `Invitados: ${invitados || 'por confirmar'}\n` +
        `Servicios: ${servicios || 'por confirmar'}\n` +
        `Monto: ${monto ? '$' + monto : 'por confirmar'}\n` +
        `Autorizado por Diana ✅`,
      start: { date: fecha },
      end: { date: fechaFinStr },
    };

    const res = await calendar.events.insert({
      calendarId: process.env.GOOGLE_CALENDAR_ID,
      resource: evento,
    });

    return res.data.htmlLink || null;
  } catch (err) {
    console.error('Error creando evento en Calendar:', err.message);
    return null;
  }
}

// ---------- GOOGLE SHEETS ----------
// Agrega una fila con la cotización confirmada a la hoja de cotizaciones/recibos.
async function agregarFilaCotizacion({ folio, negocio, fechaEvento, ubicacion, invitados, servicios, monto, clienteNombre, clienteTelefono }) {
  try {
    const auth = getAuth(['https://www.googleapis.com/auth/spreadsheets']);
    const sheets = google.sheets({ version: 'v4', auth });

    const fila = [
      new Date().toISOString(),
      folio || '',
      negocio || '',
      fechaEvento || '',
      ubicacion || '',
      invitados || '',
      servicios || '',
      monto || '',
      clienteNombre || '',
      clienteTelefono || '',
      'Autorizado',
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'A:K',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      resource: { values: [fila] },
    });

    return true;
  } catch (err) {
    console.error('Error agregando fila a Sheets:', err.message);
    return false;
  }
}

// ---------- ENVÍO DE CORREO (opcional, solo si el cliente dio su email) ----------
async function enviarCotizacionPorCorreo({ emailCliente, folio, negocio, fechaEvento, ubicacion, invitados, servicios, monto }) {
  if (!emailCliente) return false;

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto;">
        <h2 style="color:#7c3aed;">Tu cotización está confirmada 🎉</h2>
        <p><strong>Folio:</strong> ${folio}</p>
        <p><strong>Negocio:</strong> ${negocio}</p>
        <p><strong>Fecha del evento:</strong> ${fechaEvento || 'por confirmar'}</p>
        <p><strong>Ubicación:</strong> ${ubicacion || 'por confirmar'}</p>
        <p><strong>Invitados:</strong> ${invitados || 'por confirmar'}</p>
        <p><strong>Servicios:</strong> ${servicios || 'por confirmar'}</p>
        <p><strong>Monto total:</strong> $${monto || 'por confirmar'}</p>
        <p style="color:#777; font-size:0.9em;">Este es un costo aproximado y se ajustaría cuando se revise detalladamente.</p>
        <hr style="border:none;border-top:1px solid #eee; margin:20px 0;">
        <p style="font-size:0.85em; color:#999;">
          Divanna Eventos · El Vaso Maíz<br>
          <a href="https://divanna-eventos.vercel.app">divanna-eventos.vercel.app</a>
        </p>
      </div>
    `;

    await transporter.sendMail({
      from: `"Divanna Eventos / El Vaso Maíz" <${process.env.GMAIL_USER}>`,
      to: emailCliente,
      subject: `Tu cotización ${folio} está confirmada`,
      html,
    });

    return true;
  } catch (err) {
    console.error('Error enviando correo:', err.message);
    return false;
  }
}

module.exports = {
  crearEventoCalendar,
  agregarFilaCotizacion,
  enviarCotizacionPorCorreo,
};
