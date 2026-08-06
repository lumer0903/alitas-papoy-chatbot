const crypto = require('crypto');
const catalog = require('./catalog.json');

// Mapa para gestionar sesiones y elecciones de negocio por usuario
const sessions = new Map();

const money = (value) => `S/. ${Number(value).toFixed(2)}`;
const normalize = (value = '') =>
  String(value)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

// --- MENÚS Y PLANTILLAS ---

function selectBusinessMenu() {
  return `¡Hola! 👋 Bienvenido.\n\n¿Con qué negocio deseas comunicarte hoy?\n\n1️⃣ 🍗 **ALITAS PAPOY** (Alitas & Papas)\n2️⃣ 💥 **BOMBARDAS DE PÉTALOS** (Eventos & Fiestas)\n\n*(Escribe 1 o 2)*`;
}

// --- ALITAS PAPOY ---
function alitasWelcome() {
  return `🍗 **BIENVENIDO A ALITAS PAPOY**\n\n${catalog.alitas.business.location}\n🕐 Horario: ${catalog.alitas.business.schedule}\n\n¿Qué deseas hacer?\n1️⃣ VER SABORES Y PRECIOS\n2️⃣ HACER PEDIDO\n0️⃣ CAMBIAR DE NEGOCIO / INICIO`;
}

function alitasFlavors() {
  const lista = catalog.alitas.flavors
    .map((x, i) => `${i + 1}. **${x.name.toUpperCase()}** - ${money(x.price)}\n   Incluye: ${x.description}`)
    .join('\n\n');
  return `🍗 **NUESTROS SABORES**\n\n${lista}\n\n¿Deseas pedir? Escribe **2** o **PEDIDO**.`;
}

// --- BOMBARDAS ---
function bombardasWelcome() {
  const b = catalog.bombardas.business;
  const colores = b.colors.join(', ');
  return `💥 **BOMBARDAS DE PÉTALOS**\n\n✨ **Detalles:** ${b.specs}\n🎨 **Colores disponibles:** ${colores}\n\n💰 **PRECIOS:**\n• Unidad: ${b.prices.unit}\n• Por mayor: ${b.prices.wholesale}\n• Desde 12 unid. (Docena): ${b.prices.dozen}\n• Desde Caja (80 unid.): ${b.prices.box}\n\n¿Qué deseas hacer?\n1️⃣ HACER PEDIDO DE BOMBARDAS\n2️⃣ HABLAR CON UN ASESOR\n0️⃣ CAMBIAR DE NEGOCIO / INICIO`;
}

// --- LÓGICA PRINCIPAL DEL BOT ---
async function handleMessage(chatId, body) {
  const text = normalize(body);
  const session = sessions.get(chatId) || { state: 'CHOOSE_BUSINESS', business: null };

  // Comandos globales para reiniciar o cambiar de negocio
  if (['0', 'inicio', 'cambiar', 'menu', 'menú', 'hola'].includes(text) && session.state !== 'CHOOSE_BUSINESS') {
    sessions.set(chatId, { state: 'CHOOSE_BUSINESS', business: null });
    return { reply: selectBusinessMenu(), state: 'CHOOSE_BUSINESS' };
  }

  // PASO 1: Selección inicial de negocio
  if (session.state === 'CHOOSE_BUSINESS' || !session.business) {
    if (text === '1' || text.includes('alita') || text.includes('papoy')) {
      sessions.set(chatId, { state: 'ALITAS_MENU', business: 'ALITAS' });
      return { reply: alitasWelcome(), state: 'ALITAS_MENU' };
    }
    if (text === '2' || text.includes('bombarda') || text.includes('petalo')) {
      sessions.set(chatId, { state: 'BOMBARDAS_MENU', business: 'BOMBARDAS' });
      return { reply: bombardasWelcome(), state: 'BOMBARDAS_MENU' };
    }
    return { reply: selectBusinessMenu(), state: 'CHOOSE_BUSINESS' };
  }

  // PASO 2A: Flujo de ALITAS PAPOY
  if (session.business === 'ALITAS') {
    if (text === '1' || text.includes('sabor')) {
      return { reply: alitasFlavors(), state: 'ALITAS_MENU' };
    }
    if (text === '2' || text.includes('pedido')) {
      sessions.set(chatId, { ...session, state: 'ALITAS_ORDERING' });
      return {
        reply: `✅ **PEDIDO DE ALITAS**\n\nPor favor indícame:\n- Sabores y cantidad\n- Tu Nombre\n- Dirección exacta\n\n*Ejemplo: 2 Acevichado, 1 BBQ, mi nombre es Juan, vivo en Av. Perú 123*`,
        state: 'ALITAS_ORDERING'
      };
    }
    if (session.state === 'ALITAS_ORDERING') {
      const orderId = `PAPOY-${Date.now()}-${crypto.randomUUID().slice(0, 4)}`;
      sessions.set(chatId, { state: 'ALITAS_MENU', business: 'ALITAS' });
      return {
        reply: `🎉 **¡PEDIDO RECIBIDO!**\n\nCódigo: ${orderId}\nHemos registrado tu mensaje: "${body}"\n\nUn asesor de Alitas Papoy confirmará el cobro y entrega por aquí en breve.`,
        state: 'ALITAS_MENU'
      };
    }
    return { reply: alitasWelcome(), state: 'ALITAS_MENU' };
  }

  // PASO 2B: Flujo de BOMBARDAS
  if (session.business === 'BOMBARDAS') {
    if (text === '1' || text.includes('pedido')) {
      sessions.set(chatId, { ...session, state: 'BOMBARDAS_ORDERING' });
      return {
        reply: `💥 **PEDIDO DE BOMBARDAS**\n\nPor favor indícame:\n- Cantidad de unidades/cajas\n- Colores que deseas\n- Tu nombre y ciudad/dirección\n\n*Ejemplo: 12 bombardas (6 rojas, 6 blancas), mi nombre es Maria, para Lima.*`,
        state: 'BOMBARDAS_ORDERING'
      };
    }
    if (text === '2' || text.includes('asesor') || text.includes('contacto')) {
      return {
        reply: `📞 **CONTACTO BOMBARDAS**\n\nUn asesor humano te responderá por este chat en unos momentos.\nSi deseas regresar al menú principal escribe **0**.`,
        state: 'BOMBARDAS_MENU'
      };
    }
    if (session.state === 'BOMBARDAS_ORDERING') {
      const orderId = `BOMBARDA-${Date.now()}-${crypto.randomUUID().slice(0, 4)}`;
      sessions.set(chatId, { state: 'BOMBARDAS_MENU', business: 'BOMBARDAS' });
      return {
        reply: `🎉 **¡SOLICITUD DE BOMBARDAS RECIBIDA!**\n\nCódigo: ${orderId}\nDetalle recibido: "${body}"\n\nTe responderemos en breve con la cotización exacta y datos de pago.`,
        state: 'BOMBARDAS_MENU'
      };
    }
    return { reply: bombardasWelcome(), state: 'BOMBARDAS_MENU' };
  }

  return { reply: selectBusinessMenu(), state: 'CHOOSE_BUSINESS' };
}

module.exports = { handleMessage };
