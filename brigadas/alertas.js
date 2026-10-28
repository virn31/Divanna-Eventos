// brigadas/alertas.js
// Alertas de emergencia y seguridad en la app del equipo (index.html y dashboard.html).
// - Botón "Activar alertas": pide permiso y registra el teléfono para recibir
//   push con sonido y vibración aunque la app esté cerrada (ver sw.js y api/push.js).
// - Con la app abierta: cuando aparece una alerta nueva, suena y vibra aquí mismo.
(function () {
  const soportaPush = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  let obtenerToken = () => null;
  let contenedor = null;
  let conocidas = null; // claves de alertas ya vistas; null = todavía no hay referencia
  let audio = null;

  // El navegador solo deja sonar audio después de que la persona toca la
  // pantalla; se prepara en el primer toque.
  function prepararAudio() {
    if (audio) return;
    try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { audio = null; }
  }
  document.addEventListener('pointerdown', prepararAudio, { once: true });

  function sonar() {
    if (navigator.vibrate) navigator.vibrate([600, 200, 600, 200, 600]);
    if (!audio) return;
    if (audio.state === 'suspended') audio.resume().catch(() => {});
    const t0 = audio.currentTime;
    for (let i = 0; i < 3; i++) {
      const osc = audio.createOscillator();
      const vol = audio.createGain();
      osc.type = 'square';
      osc.frequency.value = i % 2 ? 660 : 880;
      vol.gain.setValueAtTime(0.0001, t0 + i * 0.5);
      vol.gain.exponentialRampToValueAtTime(0.4, t0 + i * 0.5 + 0.02);
      vol.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.5 + 0.4);
      osc.connect(vol).connect(audio.destination);
      osc.start(t0 + i * 0.5);
      osc.stop(t0 + i * 0.5 + 0.45);
    }
  }

  function base64AUint8(base64) {
    const relleno = '='.repeat((4 - (base64.length % 4)) % 4);
    const crudo = atob((base64 + relleno).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(crudo, c => c.charCodeAt(0));
  }

  async function suscribir() {
    const token = obtenerToken();
    if (!soportaPush || !token) return false;
    const { publicKey } = await fetch('/api/push').then(r => r.json());
    if (!publicKey) return false;
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64AUint8(publicKey) });
    const res = await fetch('/api/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ suscripcion: sub.toJSON() }),
    });
    return res.ok;
  }

  function pintarBoton() {
    if (!contenedor) return;
    if (!soportaPush || Notification.permission === 'granted') { contenedor.hidden = true; return; }
    contenedor.hidden = false;
    if (Notification.permission === 'denied') {
      contenedor.innerHTML = '🔕 Las alertas están bloqueadas. Actívalas en Ajustes del teléfono &gt; Apps &gt; DiMa Equipo &gt; Notificaciones.';
      return;
    }
    contenedor.innerHTML = '<span>🔔 Activa las alertas para que suenen las emergencias aunque tengas la app cerrada.</span><button type="button">Activar alertas</button>';
    contenedor.querySelector('button').addEventListener('click', async (e) => {
      e.target.disabled = true;
      prepararAudio();
      try {
        const permiso = await Notification.requestPermission();
        if (permiso === 'granted') await suscribir();
      } catch (err) {
        console.error('No se pudieron activar las alertas:', err);
      }
      pintarBoton();
    });
  }

  window.DimaAlertas = {
    // contenedorBoton: elemento donde va el botón de activar; token: función que devuelve el token de sesión.
    iniciar({ contenedorBoton, token }) {
      contenedor = contenedorBoton;
      obtenerToken = token;
      if (soportaPush) navigator.serviceWorker.register('/brigadas/sw.js').catch(() => {});
      pintarBoton();
      // Si ya dio permiso antes, se vuelve a registrar el teléfono por si cambió la suscripción.
      if (soportaPush && Notification.permission === 'granted') suscribir().catch(() => {});
    },
    // claves: identificadores de las alertas activas ahora. Suena solo si hay
    // alguna nueva desde la revisión anterior (la primera revisión no suena).
    revisar(claves) {
      const actuales = new Set(claves);
      if (conocidas) {
        for (const c of actuales) {
          if (!conocidas.has(c)) { sonar(); break; }
        }
      }
      conocidas = actuales;
    },
    reiniciar() { conocidas = null; },
  };
})();
