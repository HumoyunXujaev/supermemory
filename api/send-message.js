function escapeHtml(text) {
  if (!text) return '';
  return text
    .toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// === Маппинг form_id → название продукта ===
const FORM_NAMES = {
  "4084186411799714": "geptrafit",
  "664912399978587": "venofit",
  "720026814402812": "diafit acc",
  "814284541049637": "silamax",
  "811798847934700": "stop-artroz",
  "1152300420130073": "superpamyat"
};



async function sendTelegramMessage(name, phone, source) {
  const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

  if (!TOKEN || !CHAT_ID) {
    console.error('Telegram TOKEN or CHAT_ID is not configured.');
    return { ok: false, description: 'Server configuration error.' };
  }

  let message = `<b>🔔 Новая заявка!</b>\n\n`;
  message += `<b>Источник:</b> ${escapeHtml(source)}\n`;
  message += `<b>Имя клиента:</b> ${escapeHtml(name)}\n`;
  message += `<b>Телефон:</b> ${escapeHtml(phone)}`;

  const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: message,
        parse_mode: 'html',
      }),
    });

    const data = await response.json();
    if (!data.ok) {
      console.error('Telegram API Error:', data.description);
    }
    return data;
  } catch (error) {
    console.error('Failed to send message to Telegram:', error);
    return { ok: false, description: 'Internal fetch error.' };
  }
}

// === Основной обработчик ===
export default async function handler(request, response) {
  response.setHeader('Access-Control-Allow-Credentials', true);
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  response.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (request.method === 'OPTIONS') {
    return response.status(200).end();
  }

  // === Верификация Webhook Meta ===
  if (request.method === 'GET') {
    const mode = request.query['hub.mode'];
    const token = request.query['hub.verify_token'];
    const challenge = request.query['hub.challenge'];

    if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
      console.log('Webhook verified successfully!');
      return response.status(200).send(challenge);
    } else {
      console.error('Webhook verification failed.');
      return response.status(403).json({ message: 'Verification failed' });
    }
  }

  // === Обработка входящих POST-заявок ===
  if (request.method === 'POST') {
    console.log('=== RAW BODY ===', JSON.stringify(request.body, null, 2));
    const body = request.body;

    try {
      if (body.object === 'page') {
        const entry = body.entry?.[0];
        const change = entry?.changes?.[0];
        const leadgenId = change?.value?.leadgen_id;
        const formId = change?.value?.form_id;

        if (!leadgenId) {
          console.error('No leadgen_id in webhook payload.');
          return response.status(400).json({ message: 'leadgen_id missing' });
        }

        // === Запрашиваем данные лида через Graph API ===
        const token = process.env.META_PAGE_ACCESS_TOKEN;
        const leadResponse = await fetch(
          `https://graph.facebook.com/v23.0/${leadgenId}?access_token=${token}`
        );
        const leadJson = await leadResponse.json();
        console.log('=== LEAD DATA FROM GRAPH API ===', leadJson);
        console.log('=== LEAD DATAaaa FROM GRAPH API ===', leadResponse);


        const leadData = leadJson.field_data || [];
        const findField = (fieldName) =>
          leadData.find((f) => f.name === fieldName)?.values?.[0] ||
          'не указано';

        // Имя
        let name = findField('full_name');
        const firstName = findField('first_name');
        const lastName = findField('last_name');
        if (
          name === 'не указано' &&
          (firstName !== 'не указано' || lastName !== 'не указано')
        ) {
          name = `${firstName} ${lastName}`.trim();
        }

        // Телефон
        const phone = findField('phone_number');

        // Берём название формы из словаря
        const productName = FORM_NAMES[formId] || 'Неизвестный продукт';
        const source = `Meta Lead Ad (${productName}, Form ID: ${formId})`;

        // Отправляем в Telegram
        const telegramResult = await sendTelegramMessage(name, phone, source);
        if (telegramResult.ok) {
          return response
            .status(200)
            .json({ message: 'Meta lead processed successfully!' });
        } else {
          return response
            .status(500)
            .json({ message: 'Failed to send Meta lead to Telegram.' });
        }
      } else {
        // === Обычная заявка с лендинга ===
        const { name, phone, productName } = body;
        if (!name || !phone) {
          return response
            .status(400)
            .json({ message: 'Name and phone are required.' });
        }

        const source = productName || 'Лендинг';
        const telegramResult = await sendTelegramMessage(name, phone, source);

        if (telegramResult.ok) {
          return response
            .status(200)
            .json({ message: 'Landing page lead processed successfully!' });
        } else {
          return response
            .status(500)
            .json({ message: 'Failed to send landing page lead to Telegram.' });
        }
      }
    } catch (error) {
      console.error('Error processing POST request:', error);
      return response.status(500).json({ message: 'Internal Server Error.' });
    }
  }

  return response
    .status(405)
    .json({ message: `Method ${request.method} Not Allowed` });
}
