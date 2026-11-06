// api/_decorador.js
// Descuento de decorador (Víctor 2026-11-06): a los clientes que Diana marca en
// Airtable con CLIENTES.Tipo_Cliente = "Decorador" se les aplica 10% sobre el
// total del evento (también cuando cotiza DiMa). La opción se llamaba
// "Profesional" y se renombra; mientras tanto también vale.
// Queda una marca en EVENTOS.Notas para que el recibo muestre el descuento y los
// cambios de manteles posteriores también lleven el 10%.

const DESCUENTO_DECORADOR = 0.10;
const TIPOS_DECORADOR = ['decorador', 'profesional'];
const MARCA_DECORADOR = '🏷️ Cliente decorador: 10% de descuento aplicado al total.';

const esDecorador = (clienteFields = {}) => TIPOS_DECORADOR.includes(String(clienteFields.Tipo_Cliente || '').trim().toLowerCase());
const tieneDescuento = (eventoFields = {}) => String(eventoFields.Notas || '').includes(MARCA_DECORADOR);
const redondo = (n) => Math.round(n * 100) / 100;
const conDescuento = (monto) => redondo(monto * (1 - DESCUENTO_DECORADOR));

module.exports = { DESCUENTO_DECORADOR, MARCA_DECORADOR, esDecorador, tieneDescuento, conDescuento, redondo };
