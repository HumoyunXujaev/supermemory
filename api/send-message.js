async function sendTelegramMessage(name, phone, source) {
  const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

  if (!TOKEN || !CHAT_ID) {
    console.error('Telegram TOKEN or CHAT_ID is not configured.');
    // throw new Error("Server configuration error: Telegram secrets are missing.");
    return { ok: false, description: 'Server configuration error.' };
  }

  // Формируем красивое сообщение
  let message = `<b>🔔 Новая заявка!</b>\n\n`;
  message += `<b>Источник:</b> ${source}\n`; // Указываем, откуда пришел лид
  message += `<b>Имя клиента:</b> ${name}\n`;
  message += `<b>Телефон:</b> ${phone}`;

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
      // Логируем ошибку от Telegram для отладки
      console.error('Telegram API Error:', data.description);
    }

    return data; // Возвращаем ответ от Telegram
  } catch (error) {
    console.error('Failed to send message to Telegram:', error);
    return { ok: false, description: 'Internal fetch error.' };
  }
}

// Основной обработчик запросов
export default async function handler(request, response) {
  // Устанавливаем заголовки для CORS (важно для веб-форм)
  response.setHeader('Access-Control-Allow-Credentials', true);
  response.setHeader('Access-Control-Allow-Origin', '*'); // Разрешаем с любого источника
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  response.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // Браузеры отправляют OPTIONS запрос для проверки CORS перед POST
  if (request.method === 'OPTIONS') {
    return response.status(200).end();
  }

  // --- Обработка GET запроса для верификации Meta Webhook ---
  // Это нужно только один раз при настройке в панели разработчика Meta
  if (request.method === 'GET') {
    const mode = request.query['hub.mode'];
    const token = request.query['hub.verify_token'];
    const challenge = request.query['hub.challenge'];

    // Проверяем, что токен совпадает с нашим секретным токеном
    if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
      console.log('Webhook verified successfully!');
      return response.status(200).send(challenge);
    } else {
      console.error('Webhook verification failed.');
      return response.status(403).json({ message: 'Verification failed' });
    }
  }

  // --- Обработка POST запроса с данными ---
  if (request.method === 'POST') {
    const body = request.body;
    // Сразу после const body = request.body;
    console.log('=== RAW BODY FROM META ===');
    console.log(JSON.stringify(body, null, 2));

    try {
      // Проверяем, является ли запрос вебхуком от Meta
      if (body.object === 'page') {
        const entry = body.entry[0];
        const change = entry.changes[0];
        const leadData = change.value.field_data;
        console.log('=== ENTRY ===', JSON.stringify(entry, null, 2));
        console.log('=== CHANGE ===', JSON.stringify(change, null, 2));

        // Вспомогательная функция для поиска нужного поля в данных от Meta
        const findField = (fieldName) =>
          leadData.find((f) => f.name === fieldName)?.values[0] || 'не указано';

        // Meta может присылать имя в разных полях
        const fullName = findField('full_name');
        const firstName = findField('first_name');
        const lastName = findField('last_name');

        let name = fullName;
        if (
          name === 'не указано' &&
          (firstName !== 'не указано' || lastName !== 'не указано')
        ) {
          name = `${firstName} ${lastName}`.trim();
        }

        const phone = findField('phone_number');
        const formId = change.value.form_id;
        const source = `Meta Lead Ad (Form ID: ${formId})`;

        // Отправляем данные в Telegram
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
        // Это обычная заявка с вашего лендинга
        const { name, phone, productName } = body;

        if (!name || !phone) {
          return response
            .status(400)
            .json({ message: 'Name and phone are required.' });
        }

        const source = productName || 'Лендинг'; // Источник - название продукта или просто "Лендинг"

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

  // Если метод не GET, POST или OPTIONS
  return response
    .status(405)
    .json({ message: `Method ${request.method} Not Allowed` });
}
