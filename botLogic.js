const crypto = require('crypto');
const catalog = require('./catalog.json');

const sessions = new Map();
const money = (value) => `S/. ${Number(value).toFixed(2)}`;
const normalize = (value = '') => String(value).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

function isOpen(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: process.env.TIMEZONE || 'America/Lima', weekday: 'short', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  const hour = Number(get('hour'));
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(get('weekday')) && hour >= Number(process.env.BUSINESS_OPEN_HOUR || 18) && hour < Number(process.env.BUSINESS_CLOSE_HOUR || 24);
}

function welcome() { return `¡Hola! 👋 Bienvenido a ${catalog.business.name}\n\nEstamos en ${catalog.business.location}, delivery/entrega desde casa.\n🕐 Abiertos de 6 PM en adelante.\n\n¿Qué deseas?\n1️⃣ VER SABORES\n2️⃣ VER COMBOS\n3️⃣ HACER PEDIDO\n0️⃣ CONTACTAR`; }
function flavors() { return `🍗 NUESTROS SABORES\n\n${catalog.flavors.map((x, i) => `${i + 1}. ${x.name.toUpperCase()} - ${money(x.price)}\n   ${x.description}`).join('\n\n')}\n\nCada porción = 6 alitas\n\n¿Deseas hacer un pedido? Escribe PEDIDO`; }
function combos() { return `🎁 COMBOS ESPECIALES\n\n${catalog.combos.map((x) => `📦 ${x.name.toUpperCase()} - ${money(x.price)}\n   ${x.description}`).join('\n\n')}\n\n¿Te interesa? Escribe PEDIDO`; }
function contact() { return `📞 CONTACTO DIRECTO\n\nWhatsApp: ${catalog.business.phone}\nUbicación: ${catalog.business.location}\nHorario: ${catalog.business.schedule}\n\nUna PERSONA te atenderá inmediatamente.\n¡Gracias!`; }
function prompt() { return `✅ CONFIRMANDO TU PEDIDO\n\nEnvíame productos con cantidades, tu nombre y dirección exacta.\n\nEjemplo:\n"2 Acevichado, 1 Buffalo, 2 Chicha Morada, papas, mi nombre es Juan, vivo en Jr. Los Andes 123"`; }

function quantityBefore(text, aliases) {
  const names = aliases.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const withQuantity = new RegExp(`(?:^|[,;\\n]\\s*|\\b)(\\d+)\\s*(?:x\\s*)?(?:${names})\\b`, 'i').exec(text);
  return withQuantity ? Number(withQuantity[1]) : new RegExp(`\\b(?:${names})\\b`, 'i').test(text) ? 1 : 0;
}

function findItems(body) {
  const source = normalize(body);
  const products = [
    ...catalog.flavors.map((x) => ({ ...x, aliases: [normalize(x.name)] })),
    ...catalog.combos.map((x) => ({ ...x, aliases: [normalize(x.name)] })),
    ...catalog.drinks.map((x) => ({ ...x, aliases: [normalize(x.name), normalize(x.name.replace(' 500ml', ''))] })),
    ...catalog.extras.map((x) => ({ ...x, aliases: x.id === 'papas' ? ['papas', 'papa', 'papas fritas'] : ['salsa extra'] }))
  ];
  return products.map(({ aliases, ...item }) => ({ ...item, quantity: quantityBefore(source, aliases) })).filter((x) => x.quantity > 0);
}

const capture = (text, expression) => expression.exec(text)?.[1]?.trim();
const parseName = (text) => capture(text, /(?:mi nombre es|nombre\s*:?)\s+([^,;.\n]+)/i);
const parseAddress = (text) => capture(text, /(?:vivo en|direcci[oó]n\s*:?|dir\.?\s*:?)\s+([^\n]+)/i);
function summary(draft) {
  const total = draft.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  draft.total = total;
  const details = draft.items.map((x) => `${x.quantity}x ${x.name} (${money(x.price)}) = ${money(x.price * x.quantity)}`).join('\n');
  return `📋 RESUMEN DE TU PEDIDO\n\n${details}\n\nTOTAL: ${money(total)}\n\n📍 Dirección: ${draft.address}\n👤 Nombre: ${draft.name}\n⏱️ Tiempo estimado: ${catalog.business.estimatedDelivery}\n\n¿Confirmas? Escribe:\n✅ SI\n❌ NO / MODIFICAR`;
}
function payment() { return `✅ PEDIDO CONFIRMADO\n\nTus opciones de pago:\n\n💵 EFECTIVO\nPaga al momento de la entrega\n\n💳 TRANSFERENCIA\n${catalog.business.paymentInstructions.transfer}\n\nUna PERSONA te contactará en breve para confirmar dirección y cobro.\n\n¿DUDA? Llama: ${catalog.business.phone}\n¡Gracias! 🎉`; }

async function handleMessage(chatId, body) {
  const text = normalize(body);
  if (!isOpen()) return { reply: 'Estamos cerrados. Abrimos de lunes a viernes desde las 6 PM.', state: 'CLOSED' };
  const session = sessions.get(chatId) || { state: 'MENU' };
  if (text === '0' || text.includes('contactar')) { sessions.set(chatId, { state: 'MENU' }); return { reply: contact(), state: 'MENU' }; }
  if (session.state === 'CONFIRMING') {
    if (/^(si|sí|confirmo|confirmar)$/.test(text)) {
      const order = { id: `PAPOY-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`, nombre: session.draft.name, sabores: session.draft.items.filter((x) => catalog.flavors.some((f) => f.id === x.id)), productos: session.draft.items, total: session.draft.total, direccion: session.draft.address, timestamp: new Date().toISOString(), chatId, status: 'confirmed' };
      sessions.set(chatId, { state: 'MENU' }); return { reply: payment(), state: 'MENU', order };
    }
    if (/^(no|modificar)/.test(text)) { sessions.set(chatId, { state: 'ORDERING', draft: session.draft }); return { reply: `De acuerdo. ${prompt()}`, state: 'ORDERING' }; }
    return { reply: 'Responde SI para confirmar o NO / MODIFICAR para cambiar el pedido.', state: 'CONFIRMING' };
  }
  if (session.state === 'ORDERING') {
    const draft = { ...(session.draft || {}), items: findItems(body).length ? findItems(body) : session.draft?.items || [], name: parseName(body) || session.draft?.name, address: parseAddress(body) || session.draft?.address };
    const missing = [!draft.items.length && 'productos y cantidades', !draft.name && 'tu nombre (ej. mi nombre es Ana)', !draft.address && 'tu dirección (ej. vivo en Jr. ...)'].filter(Boolean);
    if (missing.length) { sessions.set(chatId, { state: 'ORDERING', draft }); return { reply: `Para armar el resumen me falta: ${missing.join(', ')}.\n\n${prompt()}`, state: 'ORDERING' }; }
    sessions.set(chatId, { state: 'CONFIRMING', draft }); return { reply: summary(draft), state: 'CONFIRMING' };
  }
  if (text === '1' || text.includes('sabor')) return { reply: flavors(), state: 'MENU' };
  if (text === '2' || text.includes('combo')) return { reply: combos(), state: 'MENU' };
  if (text === '3' || text.includes('pedido')) { sessions.set(chatId, { state: 'ORDERING' }); return { reply: prompt(), state: 'ORDERING' }; }
  if (['hola', 'buenas', 'inicio', 'menu', 'menú'].includes(text)) return { reply: welcome(), state: 'MENU' };
  return { reply: 'Disculpa, no entiendo. Escribe: 1 (sabores), 2 (combos), 3 (pedido), 0 (contactar)', state: 'MENU' };
}

module.exports = { handleMessage, isOpen, welcome };
