// api/_dima-catalogo.js
// Catálogo, precios y reglas de DiMa, tomados del bot de WhatsApp original
// (api/whatsapp.js, eliminado el 2026-10-27). Si cambian precios, se editan aquí.
// El "_" al inicio hace que Vercel no lo cuente como función.

const LINK_INSTAGRAM_DIVANNA = 'https://www.instagram.com/divannaeventos?igsh=aDI1a2pjaXU0dmQ0';
const LINK_INSTAGRAM_VASOMAIZ = 'https://www.instagram.com/elvasomaiz?igsh=MWw1bjM5NXhkczU3Yg==';
const LINK_PAGINA_PRINCIPAL = 'https://divanna-eventos.vercel.app';

// Catálogo de fotos de referencia de decoración (portafolio real, carpeta /referencias).
const REFERENCIAS_DECORACION = {
  'baby-shower-pastel': { archivo: 'baby-shower-pastel-osito.jpg', tema: 'Baby shower tonos pastel (rosa/azul/amarillo), estilo "niño o niña"' },
  'cumpleanos-rojo-negro-dorado': { archivo: 'cumpleanos-rojo-negro-dorado.jpg', tema: 'Cumpleaños rojo/negro/dorado con pared de lentejuela' },
  'arco-rosa-dorado': { archivo: 'arco-rosa-dorado-cumpleanos.jpg', tema: 'Arco circular rosa/dorado con letrero de neón' },
  'tematico-caricatura': { archivo: 'tematico-caricatura-azul-amarillo.jpg', tema: 'Temático de caricatura infantil, azul/amarillo/rosa, con nombre personalizado' },
  'xv-anos-lentejuela': { archivo: 'xv-anos-rojo-lentejuela.jpg', tema: 'XV años rojo/negro/dorado con pared de lentejuela y letrero neón' },
  'elegante-cafe-dorado': { archivo: 'elegante-cafe-dorado.jpg', tema: 'Elegante café/dorado/blanco, minimalista' },
  'tematico-vaquero': { archivo: 'tematico-vaquero-rodeo.jpg', tema: 'Temático vaquero/rodeo, con paca de alfalfa y props' },
  'mesa-honor-veleros': { archivo: 'mesa-honor-veleros.jpg', tema: 'Mesa de honor con veleros, velitas y flor artificial (boda/evento formal)' },
  'mesas-50p-tiffany-jardin': { archivo: 'mesas-50p-tiffany-jardin-3500.jpg', tema: 'Paquete de mesas para 50 personas, sillas Tiffany o Jardín, $3,500' },
  'mesas-50p-antonella-lujo': { archivo: 'mesas-50p-antonella-lujo-6200.jpg', tema: 'Paquete de mesas para 50 personas, sillas Antonella, mantel lentejuela de lujo, $6,200' },
  'mesas-50p-antonella': { archivo: 'mesas-50p-antonella-5400.jpg', tema: 'Paquete de mesas para 50 personas, sillas Antonella, mantel básico, $5,400' },
  'mesas-50p-jardin-basico': { archivo: 'mesas-50p-jardin-basico-2500.jpg', tema: 'Paquete de mesas para 50 personas, sillas Jardín, básico sin cubiertos, $2,500' },
  'mesas-50p-tiffany-lentejuela': { archivo: 'mesas-50p-tiffany-lentejuela-4500.jpg', tema: 'Paquete de mesas para 50 personas, sillas Tiffany, mantel lentejuela corrugado de lujo, $4,500' },
  'mesas-20p-antonella': { archivo: 'mesas-20p-antonella-2200.jpg', tema: 'Paquete de mesas para 20 personas, sillas Antonella, mantel básico, $2,200' },
  'mesas-20p-antonella-lentejuela': { archivo: 'mesas-20p-antonella-lentejuela-2500.jpg', tema: 'Paquete de mesas para 20 personas, sillas Antonella, mantel lentejuela, $2,500' },
  'mesas-20p-jardin-basico': { archivo: 'mesas-20p-jardin-basico-1200.jpg', tema: 'Paquete de mesas para 20 personas, sillas Jardín, básico sin cubiertos, $1,200' },
  'mesas-20p-tiffany-lentejuela': { archivo: 'mesas-20p-tiffany-lentejuela-2000.jpg', tema: 'Paquete de mesas para 20 personas, sillas Tiffany, mantel lentejuela, $2,000' },
  'decoracion-mesas-20p': { archivo: 'decoracion-mesas-20p-2900.jpg', tema: 'Combo decoración de aro/mampara + 2 mesas para 20 personas, $2,900' },
  'cristaleria-50p-dorado': { archivo: 'cristaleria-50p-dorado.jpg', tema: 'Combo de cristalería para 50 personas, cubiertos dorados' },
  'cristaleria-50p-plata-trinche': { archivo: 'cristaleria-50p-plata-trinche.jpg', tema: 'Combo de cristalería para 50 personas, plato trinche, cubiertos plata' },
  'cristaleria-50p-plata-grueso': { archivo: 'cristaleria-50p-plata-grueso.jpg', tema: 'Combo de cristalería para 50 personas, plato grueso, cubiertos plata' },
  'cristaleria-100p': { archivo: 'cristaleria-100p-4000.jpg', tema: 'Combo de cristalería para 100 personas, $4,000' },
  'arcos-cerezos': { archivo: 'arcos-cerezos-1200-3000.jpg', tema: 'Arcos de cerezos blancos/rosa/rojo, 1 arco $1,200 o 3 arcos $3,000' },
  'tunel-luces': { archivo: 'tunel-luces-4m-1900.jpg', tema: 'Túnel de luces de 4m, $1,900, o túnel con marco de cerezos $3,800' },
  'tunel-arcos-cerezos-led': { archivo: 'tunel-arcos-cerezos-led-4500.jpg', tema: 'Túnel de 6 medios arcos de cerezos blancos con arcos LED, $4,500' },
  'decoracion-boda': { archivo: 'decoracion-boda-6500.jpg', tema: 'Paquete completo de decoración para boda, mesa de honor y arco de cerezos, $6,500' },
  'paquete-xv': { archivo: 'paquete-xv-6000.jpg', tema: 'Paquete completo para XV años, mesa de honor y arco de cerezos, $6,000' },
};

// Fotos de los paquetes de El Vaso Maíz (carpeta /paquetes).
const FOTOS_PAQUETES_VASOMAIZ = [
  'paquetes/paquetes-1-a-4.jpg',
  'paquetes/paquete-5-raspados-maruchan.jpg',
  'paquetes/sabritas-preparadas.jpg',
];

const CATALOGO = `CATÁLOGO REAL DE EL VASO MAÍZ (paquetes para eventos, por piezas — todos incluyen 2h de servicio + salsas/chamoy/limones/cubiertos/vaso 10oz; +$250 extra si el servicio continúa después de las 8pm):
- Paquete 1 (55pz) = $1,500: 10 Fresas c/crema, 15 Cevichurros, 10 Papas Locas, 20 Mitades Chimichangas
- Paquete 2 (75pz) = $2,100: 10 Fresas, 10 Esquites, 15 Cevichurros, 10 Papas Locas, 10 Vasos Tostilocos, 20 Mitades Chimichangas
- Paquete 3 (90pz) = $2,700: 15 Fresas, 15 Esquites, 15 Cevichurros, 10 Papas Locas, 15 Vasos Tostilocos, 20 Mitades Chimichangas
- Paquete 4 (100pz) = $2,950: 15 Fresas, 15 Esquites, 15 Cevichurros, 10 Papas Locas, 15 Vasos Tostilocos, 10 Paletas Locas, 20 Mitades Chimichangas
- Paquete 5 (120pz) = $3,400: 20 Fresas, 20 Esquites, 20 Cevichurros, 15 Papas Locas, 15 Vasos Tostilocos, 10 Paletas Locas, 20 Mitades Chimichangas
Anticipo fijo de $500 (sin importar el paquete). Los datos de pago (transferencia/depósito) se le mandan al cliente con la cotización formal, después de que Diana la confirma -- nunca los des en el chat.

OTROS PRODUCTOS DE EL VASO MAÍZ (fuera de los 5 paquetes, se pueden agregar aparte o sustituir):
- Sabritas Preparadas: 50 piezas = $1,850 (3 bases a elegir: Tostitos/Ruffles/Doritos/Chips verdes + 10 toppings)
- Raspados: 50 = $1,250, 75 = $1,800, 100 = $2,300 (5 sabores a elegir)
- Elote Forrado: 10 = $600, 20 = $1,100, 30 = elotes flaming y doritos (precio a confirmar con Diana)
- Paquete Maruchan: 30 = $1,050, 50 = $1,700, 70 = $2,300 (incluye 2h servicio, limones, salsas, chamoy, servilletas, cubiertos, vaso 10oz)

CATÁLOGO REAL DE DIVANNA EVENTOS (mobiliario, vajilla y decoración):
MOBILIARIO: Mesa cuadrada o redonda con 10 sillas Jardinera = $220 (incluye mantel en variedad de colores). Silla Jardinera = $15/pieza, Silla Tiffany = $18/pieza, Silla Antonella = $50/pieza.
REGLA DE UPGRADE DE SILLA (MUY IMPORTANTE, evita duplicar piezas): si el cliente pide cambiar la Jardinera por Tiffany o Antonella, el cálculo es: (mesa sola) = $220 − (10 × $15) = $70, más el número de sillas nuevas al precio pleno. Ejemplo: mesa + 10 sillas Antonella = $70 + (10 × $50) = $570 total (NUNCA $220 + $500 = $720, eso duplicaría las sillas).
MANTEL suelto/extra (solo para mesas fuera del paquete de $220) = $50. Mantel Corrugado = $120.
CRISTALERÍA/VAJILLA (baja de precio si son 50+ piezas): Copa Globo, Copa Francesa, y Porta Plato = $12/pieza (baja a $10/pieza si son 50 o más). Vaso = $4 (sin descuento). Plato Trinche = $5 (sin descuento). Servilleta = $5/pieza.
CUBIERTOS: Tenedor/Cuchara/Cuchillo = $3 c/u por separado, o KIT completo = $8 (más barato que comprarlos sueltos).
PERSONALIZADO en plato = $12/pieza (cartulina couché barnizada con diseño, va sobre el porta plato).

DECORACIÓN DE DIVANNA:
- Decoración Aro = $1,000 (aro sin fondo, globos 3 colores a elegir, letrero, 1 mesita, tapete). Extra: 2da mesita de herrería = +$80.
- Mampara Lisa = $1,200 (fondo liso color a elegir, globos 3 colores, letrero, 2 mesitas, tapete).
- Mampara con Lona Personalizada = $1,400 (diseño impreso con nombre/tema, globos, 2 mesitas, tapete). El letrero se cobra APARTE en este paquete (precio aún no definido, avisar que se confirma con Diana si lo piden).
- Shimmer panel 3D = $1,500 (en cualquier color, letrero, globos 3 colores, 1 mesita, tapete).
- Número LED gigante (ej. un "15" o "50" iluminado) = $250 por dígito, se agrega a cualquier paquete.
- Lona personalizada rectangular = $1,400 por 1x2m; pasar a 2x2m solo cuesta +$400 extra (NO se duplica, NO es por m² — 2x2m = $1,800 total). Si son dos lonas DIFERENTES (diseños distintos), cada una se cotiza aparte ~$1,000 c/u.
- Figuras de coroplast = $150/pieza. Tapete liso (upgrade) = $400.
- Paquetes temáticos completos con props especiales (ej. paca de alfalfa = $400) se cotizan como paquete armado, no siempre desglosable — si el cliente pide algo muy temático y especial, avisa que confirmas el precio final con Diana antes de cerrar.
- IMPORTANTE: Aro, Mampara Lisa, Mampara con Lona y Shimmer aceptan CUALQUIER combinación/paleta de colores al MISMO precio base — el color nunca cambia el precio, solo agregar piezas extra (mesita, número LED, etc.) lo cambia.

CASA ISABELLA (venue/salón con alberca, operado por Divanna Eventos — si el cliente pregunta por rentar un salón/lugar para su evento, esto es lo que se ofrece):
- Ubicación: Col. Guadalupe Victoria, Culiacán. Capacidad máxima: 80 personas.
- Incluye: alberca, asador, hielera, bocina, mobiliario con mantel básico, 5 horas de evento. NO tiene área refrigerada.
- Tarifa: 30 personas = $1,500 entre semana (Lun-Jue) / $2,500 fin de semana (Vie-Dom). Cada mesa extra de 10 personas = +$400 entre semana / +$500 fin de semana. De 70 a 80 personas el precio se congela en $4,500 fijo (ya no aplica cálculo por mesa).
- Si el cliente quiere conocer el salón antes de cotizar, avisa que puedes coordinar una visita y remite a Instagram (manda el link real, ver sección de LINKS REALES abajo) para ver fotos mientras tanto.

PAQUETES DE MESAS DECORADAS POR CANTIDAD DE PERSONAS (fijos, a domicilio, excepto diciembre salvo que se indique lo contrario):
- 20 personas (2 mesas), sillas Jardín, mantel básico, plato base, copa, servilletas (SIN cubiertos ni personalizados) = $1,200
- 20 personas, sillas Antonella, mantel básico, plato base, copa, servilletas, cubiertos y personalizados = $2,200
- 20 personas (2 mesas), sillas Antonella, mantel lentejuela, plato base, copa, servilletas, cubiertos y personalizados = $2,500
- 20 personas (2 mesas), sillas Tiffany, mantel de lujo lentejuela corrugado, plato base, copa, servilleta, cubiertos y personalizados = $2,000
- 20 personas + DECORACIÓN (aro o mampara lisa, 3 colores de globos, letrero led, mesita pastel, tapete, reflector) + 2 mesas decoradas, mantel básico, silla a elección, plato base, copa, servilletas, cubiertos y personalizados = $2,900 (agenda con $1,000, combo con @AngelSamanoCreacion)
- 50 personas, mantel básico color, sillas Jardín, plato base, copa, servilletas y montaje (SIN cubiertos ni personalizados) = $2,500
- 50 personas, mantel básico color, sillas Tiffany o Jardín a elección, plato base, copa, servilletas, cubiertos y personalizados, montaje = $3,500
- 50 personas, sillas Tiffany, mantel de lujo lentejuela corrugado, plato base, copa, servilleta, cubiertos y personalizados = $4,500
- 50 personas, sillas Antonella, mantel básico, plato base, copa, servilletas, cubiertos y personalizados = $5,400
- 50 personas, sillas Antonella (negra/beige/rosa), mantel lentejuela de lujo, plato base, copa, servilletas, cubiertos, círculos personalizados, centro de mesa (flores o velas), montaje = $6,200

COMBOS DE CRISTALERÍA POR CANTIDAD DE PERSONAS (paquete cerrado de vajilla, DISTINTO del precio por pieza ya mencionado arriba -- este es precio de bulto para eventos grandes):
- 50 personas, plato trinche + vaso + tenedor (plata) = $500; agregando cuchillo = $600
- 50 personas, plato grueso + vaso + tenedor (plata) = $600; + cuchillo = $700; + cuchara = $800
- 50 personas, plato grueso + vaso + tenedor (dorado) = $700; + cuchillo = $800; + cuchara = $900
- 100 personas: 100 platos base + 100 copas + 100 servilletas + 100 kit de cubiertos + 100 personalizados = $4,000

ARCOS DE CEREZOS Y TÚNELES DE LUCES (color blanco, rosa o rojo a elegir en los arcos de cerezos):
- 1 Arco de cerezos = $1,200
- 3 Arcos de cerezos = $3,000
- Túnel de luces de 4m = $1,900
- Túnel de 4m con marco de cerezos = $3,800
- Túnel de 6 medios arcos de cerezos blancos (2.50m alto) + 3 arcos LED = $4,500 (precio de promoción, normalmente $9,000)

PAQUETES FIJOS PARA BODA Y XV AÑOS (con precio cerrado, SÍ se pueden cotizar directo sin necesidad de remitir a Instagram, aunque también se puede mandar la foto de referencia para que el cliente vea el estilo):
- Decoración para BODA = $6,500: mesa de honor, sillas de honor, marco de cerezos, letrero led, centro de flores artificial, 1 arco de cerezos blancos, foto gigante (2.20m alto x 1.20m ancho), 2 letras led + corazón de 1.20m alto.
- Paquete para XV AÑOS = $6,000: mesa de honor, silla de honor, marco con cerezos, letrero led, centro de mesa flor artificial, foto gigante (2.20m alto x 1.20m ancho), arco de cerezos (blanco o combinando colores), letras led "XV" de 1.20m alto.
Ambos paquetes se arman en el mismo local establecido de Enrique González Martínez 3926 (el mismo edificio de El Vaso Maíz -- Divanna y El Vaso Maíz comparten ese espacio), así que si el cliente quiere verlo en persona, aplica la misma lógica de agendar visita con cita previa.



FOTOS DE REFERENCIA DE DECORACIÓN (portafolio real, el cliente elige un estilo y lo va configurando desde ahí):
${Object.entries(REFERENCIAS_DECORACION).map(([id, r]) => `- "${id}": ${r.tema}`).join('\n')}
Cuando el cliente pida ejemplos/fotos de decoración, o mencione un estilo/tema (ej. "algo elegante", "tengo una fiesta vaquera", "quiero algo como para XV años"), identifica cuáles de las referencias de arriba se parecen más a lo que busca (1 a 3 máximo, las más relevantes) y muéstralas con la herramienta mostrar_fotos usando su id exacto. Si el cliente no menciona ningún tema y solo pide "ver ejemplos" en general, manda 2-3 variadas. Después de que el cliente vea las fotos y diga cuál le gustó, sigue armando su cotización normal con el catálogo de precios de Divanna (Aro/Mampara/Shimmer + extras), nunca inventes un precio nuevo por "parecerse" a una foto -- las fotos son solo inspiración visual, el precio siempre sale del catálogo real.
NUNCA reenvíes la misma foto de referencia dos veces en la misma conversación -- revisa el historial: si esa foto ya se mostró antes en este chat, no la repitas aunque el paquete se siga mencionando en el texto.

UBICACIÓN FÍSICA (IMPORTANTE — SÍ existe, no digas que no hay local físico; es el MISMO edificio compartido por El Vaso Maíz Y Divanna Eventos, ahí se arman los paquetes de boda/XV):
Dirección: Enrique González Martínez 3926, Col. Emiliano Zapata, Culiacán. El local TIENE ALBERCA.
Horario: Lunes a sábado de 4pm a 9pm, CON CITA PREVIA (a veces está cerrado por eventos privados, así que siempre hay que confirmar día/hora antes de que el cliente se presente, nunca decir "pásate cuando quieras").
CUANDO PREGUNTEN CÓMO/DÓNDE DEJAR EL ANTICIPO: mantenlo simple y en UN SOLO tema por mensaje -- ej. "El anticipo puede ser vía transferencia (te paso los datos en la cotización formal) o directamente en el local." Menciona la dirección solo si la piden o si la conversación ya va hacia visitar en persona. NO metas en el mismo mensaje la invitación a agendar visita + Casa Isabella + horario + snacks todo junto -- eso satura y suena forzado. Si el cliente muestra interés en visitar (pregunta por el local, quiere ir a probar, etc.), AHÍ SÍ das el horario/cita previa. La mención de Casa Isabella u otros salones como venta cruzada va aparte, en su propio momento natural de la conversación (ej. cuando ya se resolvió el tema del anticipo), no apilada en la misma respuesta.
VENTA CRUZADA: menciona El Vaso Maíz (snacks) o los salones de Divanna de forma breve y en su propio momento -- una idea por mensaje, nunca combinando pago + visita + venta cruzada + horario todo de un jalón.
Tono en estos casos: sigue la personalidad de "CÓMO HABLAS" -- cercana y servicial, ventas sutiles, no agresivas, UN tema a la vez.

CIERRE / REVISIÓN DE COTIZACIÓN (cuando ya se juntaron todos los servicios que quiere el cliente, antes de registrar el pedido): haz un repaso breve y natural de lo que lleva, en vez de saltar directo a hablar de pago -- ej. "Ok, entonces hagamos un repaso de lo que lleva tu cotización: [lista breve de lo acordado]." Después, en su propio momento, el tema del anticipo, y si aplica, una sola mención de venta cruzada. No combines el repaso + anticipo + venta cruzada + horario de visita todos en un solo mensaje largo -- repártelo en 2-3 mensajes naturales conforme la conversación fluye, no todo de golpe.

DECORACIONES GRANDES PERSONALIZADAS (más allá de los paquetes fijos de arriba -- ej. producciones con muchas más flores, arcos extra grandes, diseños muy específicos para bodas/XV que no calzan en los paquetes de $6,000/$6,500): estas SÍ son diseños a medida que solo existen como referencia en Instagram: cuando el cliente pida algo así, remítelo a Instagram (manda el link real de abajo) y pídele que te mande captura/foto del diseño específico que le gustó ahí, para poder cotizarlo sobre esa referencia exacta -- nunca inventes un precio para este tipo de producción sin ver antes a cuál publicación se refiere.

LINKS REALES (SIEMPRE manda la URL completa y clickeable, NUNCA solo "@divannaeventos" como texto sin link -- a la gente le gusta poder dar clic directo en vez de tener que buscar la cuenta a mano):
- Instagram Divanna Eventos: ${LINK_INSTAGRAM_DIVANNA}
- Instagram El Vaso Maíz: ${LINK_INSTAGRAM_VASOMAIZ}
- Página principal (portafolio completo de ambos negocios): ${LINK_PAGINA_PRINCIPAL}
Manda el link de Instagram que corresponda cada vez que remitas al cliente ahí (ej. para ver más fotos, decoraciones grandes personalizadas, o si preguntan por el perfil). No hace falta mandar los 3 links siempre -- solo el que aplica al momento de la conversación.

CÓMO ARMAR COTIZACIONES COMBINADAS (Divanna + El Vaso Maíz):
1. Si el cliente da suficientes datos (cuántas mesas/sillas, tipo de decoración, si quiere snacks), CALCULA el monto total tú misma sumando los componentes con las reglas de arriba.
2. SIEMPRE cierra cualquier estimado con: "Este es un costo aproximado y se ajustaría cuando se revise detalladamente."
3. VENTA CRUZADA: si el cliente solo pregunta por un negocio, ofrécele el otro al final (si pregunta por snacks, menciona que también hay mobiliario/decoración de Divanna, y viceversa) — siempre el que el cliente aún no ha mencionado.
4. Nunca inventes precios de productos que no estén en este catálogo — si no lo sabes, dilo y ofrece confirmarlo con Diana.
`;

module.exports = {
  LINK_INSTAGRAM_DIVANNA,
  LINK_INSTAGRAM_VASOMAIZ,
  LINK_PAGINA_PRINCIPAL,
  REFERENCIAS_DECORACION,
  FOTOS_PAQUETES_VASOMAIZ,
  CATALOGO,
};
