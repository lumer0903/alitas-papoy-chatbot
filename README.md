# ALITAS PAPOY — bot de WhatsApp

Servicio Node.js/Express que recibe mensajes por webhook de Kapso, toma pedidos, calcula totales y guarda los pedidos confirmados en `pedidos.json`.

## Instalar y ejecutar

Requiere Node.js 18.18 o superior.

```powershell
npm install
Copy-Item .env.example .env
# Completa KAPSO_API_KEY y KAPSO_WEBHOOK_SECRET en .env
npm start
```

Comprueba el servicio con `GET http://localhost:3000/health`.

## Configurar Kapso

1. Publica el servicio por HTTPS (Railway o Render) y registra `https://TU-DOMINIO/webhook/whatsapp` como webhook para el evento `whatsapp.message.received`.
2. Copia el secreto que genera Kapso en `KAPSO_WEBHOOK_SECRET`.
3. Copia la API key de Kapso en `KAPSO_API_KEY` y deja `KAPSO_PHONE_NUMBER_ID` con el ID del número de WhatsApp.

El endpoint verifica `X-Webhook-Signature` como HMAC-SHA256 del cuerpo **sin modificar**, compara con tiempo constante e ignora reintentos mediante `X-Idempotency-Key` y el ID de cada mensaje. Acepta el evento Kapso v2 y los payloads Meta reenviados por Kapso, incluidos los lotes.

Las respuestas se envían a:

```text
POST https://api.kapso.ai/meta/whatsapp/v24.0/{KAPSO_PHONE_NUMBER_ID}/messages
```

con `X-API-Key` y el payload de texto de WhatsApp. El webhook debe devolver 200 dentro de 10 segundos; un error devuelve 500 para que Kapso pueda reintentarlo.

## Flujo y datos

El bot está activo de lunes a viernes entre `BUSINESS_OPEN_HOUR` y `BUSINESS_CLOSE_HOUR` en `TIMEZONE` (por defecto, Lima, 18:00–23:59). Mantiene en memoria los estados `MENU`, `ORDERING` y `CONFIRMING`; por ello una conversación pendiente se reinicia si el proceso se reinicia.

Al confirmar con `SI`, guarda un objeto con `id`, `nombre`, `sabores`, `total`, `direccion` y `timestamp` en `pedidos.json`. También crea `webhook-events.json` para la deduplicación persistente. Ambos archivos son datos de ejecución: usa una base de datos o volumen persistente si escalas a varias instancias.

Edita `catalog.json` para precios, sabores y datos comerciales. El bot no cobra ni procesa pagos; solo presenta los métodos y deja el contacto final a una persona.

## Railway / Render

Sube esta carpeta, instala dependencias con `npm install` y usa `npm start`. Define las variables de `.env.example` en el panel de la plataforma. Railway/Render proporcionan `PORT`; no lo fijes allí salvo que la plataforma lo requiera. En Render, asegúrate de usar un disco persistente si necesitas conservar los archivos JSON entre despliegues.

## Seguridad

No subas `.env`, `pedidos.json` ni `webhook-events.json` al repositorio. Rota el secreto del webhook si se filtra y usa solo la URL HTTPS pública como destino de Kapso.
