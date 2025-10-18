// === Функция экранирования HTML ===
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

// === Маппинг СТАРЫХ form_id → название продукта ===
const FORM_NAMES = {
  4149632865255513: 'geptrafit',
  2197383904095104: 'venofit',
  2077372786002091: 'diafit acc',
  2006596446846389: 'silamax',
  1238732341637419: 'stop-artroz',
  1311527377012639: 'superpamyat',
};

// === Маппинг НОВЫХ form_id → название продукта ===
const NEW_FORM_NAMES = {
  1106929934547964: 'Venofit',
  1522683212077748: 'Geptrafit',
  25156805657278145: 'Diafit ACC',
  657507350520152: 'Stopartroz',
  1118745887100923: 'Silamax',
  1503515184304874: 'Superpamyat',
};

// === ID Нового Telegram чата ===
const NEW_CHAT_ID = '-1003102429452';

// === Функция отправки сообщения в Telegram ===
async function sendTelegramMessage(chatId, messageText) {
  const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

  if (!TOKEN || !chatId) {
    console.error('Telegram TOKEN or CHAT_ID is missing.');
    return { ok: false, description: 'Server configuration error.' };
  }

  const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: messageText,
        parse_mode: 'html',
      }),
    });

    const data = await response.json();
    if (!data.ok) {
      console.error(
        `Telegram API Error (ChatID: ${chatId}):`,
        data.description
      );
    }
    return data;
  } catch (error) {
    console.error(
      `Failed to send message to Telegram (ChatID: ${chatId}):`,
      error
    );
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
  } // === Верификация Webhook Meta ===

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
  } // === Обработка входящих POST-заявок ===

  if (request.method === 'POST') {
    console.log('=== RAW BODY ===', JSON.stringify(request.body, null, 2));
    const body = request.body;
    const OLD_CHAT_ID = process.env.TELEGRAM_CHAT_ID; // ID старого чата

    try {
      // === Если это лид с Meta (Facebook/Instagram) ===
      if (body.object === 'page') {
        const entry = body.entry?.[0];
        const change = entry?.changes?.[0];
        const leadgenId = change?.value?.leadgen_id;
        const formId = change?.value?.form_id;

        if (!leadgenId) {
          console.error('No leadgen_id in webhook payload.');
          return response.status(400).json({ message: 'leadgen_id missing' });
        } // === Запрашиваем данные лида через Graph API ===

        const token = process.env.META_PAGE_ACCESS_TOKEN;
        const leadResponse = await fetch(
          `https://graph.facebook.com/v23.0/${leadgenId}?access_token=${token}`
        );
        const leadJson = await leadResponse.json();
        console.log('=== LEAD DATA FROM GRAPH API ===', leadJson);

        const leadData = leadJson.field_data || [];
        const findField = (fieldName) =>
          leadData.find((f) => f.name === fieldName)?.values?.[0] ||
          'не указано'; // Имя

        // --- ИСПРАВЛЕНИЕ 1: Добавляем проверку новых полей (узб.) ---
        let name = findField('full_name');
        if (name === 'не указано') {
          name = findField('исмингиз?'); // Поиск по узбекскому названию поля
        }

        const firstName = findField('first_name');
        const lastName = findField('last_name');
        if (
          name === 'не указано' &&
          (firstName !== 'не указано' || lastName !== 'не указано')
        ) {
          name = `${firstName} ${lastName}`.trim();
        } // Телефоны

        let phoneMain = findField('phone_number');
        if (phoneMain === 'не указано') {
          phoneMain = findField('телефон_рақамингиз?'); // Поиск по узбекскому названию поля
        }

        const phoneExtra = findField(
          'biz_sizga_telefon_qilishimiz_uchun,_raqamingizni_qoldiring.'
        );
        const phoneUzbek = findField('телефон_рақамингиз?'); // Также получаем это поле // === Определяем продукт и флаг новой формы ===
        // --- КОНЕЦ ИСПРАВЛЕНИЯ 1 ---

        let productName;
        let isNewForm = false;

        // --- ИСПРАВЛЕНИЕ 2: Меняем логику определения новой формы ---
        // Если формы НЕТ в старом списке, считаем ее НОВОЙ
        if (FORM_NAMES[formId]) {
          productName = FORM_NAMES[formId];
          isNewForm = false; // Это старая форма
        } else {
          // Это НЕ старая форма, значит - новая.
          isNewForm = true;
          // Пытаемся найти название в новом списке, или ставим "Неизвестный"
          productName = NEW_FORM_NAMES[formId] || 'Неизвестный продукт';
        } // === Готовим базовые части сообщения ===
        // --- КОНЕЦ ИСПРАВЛЕНИЯ 2 ---
        const namePart = `<b>Имя клиента:</b> ${escapeHtml(name)}\n`;
        const phoneMainPart = `<b>📞 Основной номер:</b> ${escapeHtml(
          phoneMain
        )}\n`;
        let phoneExtraPart = '';
        // --- ИСПРАВЛЕНИЕ 3: Улучшаем логику доп. номера ---
        // Проверяем старое поле доп. номера
        if (
          phoneExtra &&
          phoneExtra !== 'не указано' &&
          phoneExtra !== phoneMain
        ) {
          phoneExtraPart = `<b>📞 Доп. номер:</b> ${escapeHtml(phoneExtra)}\n`;
        }
        // Если его нет, проверяем новое узбекское поле (вдруг оно отличается от основного)
        else if (
          phoneUzbek &&
          phoneUzbek !== 'не указано' &&
          phoneUzbek !== phoneMain
        ) {
          phoneExtraPart = `<b>📞 Доп. номер:</b> ${escapeHtml(phoneUzbek)}\n`;
        } // === 1. Отправка в СТАРЫЙ чат ===
        // --- КОНЕЦ ИСПРАВЛЕНИЯ 3 ---

        const sourceForOldChat = `Meta Lead Ad (${
          isNewForm ? '*' : ''
        }${productName}${isNewForm ? '*' : ''}, Form ID: ${formId})`;
        const messageForOldChat =
          `<b>🔔 Новая заявка!</b>\n\n` +
          `<b>Источник:</b> ${escapeHtml(sourceForOldChat)}\n` +
          namePart +
          phoneMainPart +
          phoneExtraPart;
        const telegramResult1 = await sendTelegramMessage(
          OLD_CHAT_ID,
          messageForOldChat
        ); // === 2. Отправка в НОВЫЙ чат (только если форма новая) ===

        if (isNewForm) {
          const sourceForNewChat = `Meta Lead Ad (${productName}, Form ID: ${formId})`; // Без звезды
          const messageForNewChat =
            `<b>🔔 Новая заявка!</b>\n\n` +
            `<b>Источник:</b> ${escapeHtml(sourceForNewChat)}\n` +
            namePart +
            phoneMainPart +
            phoneExtraPart; // Отправляем во второй чат, но не ждем ответа, чтобы не блокировать основной
          sendTelegramMessage(NEW_CHAT_ID, messageForNewChat).catch((err) => {
            console.error('Failed to send message to NEW chat:', err);
          });
        } // Отвечаем серверу Meta на основе результата *первой* отправки

        if (telegramResult1.ok) {
          return response
            .status(200)
            .json({ message: 'Meta lead processed successfully!' });
        } else {
          return response
            .status(500)
            .json({ message: 'Failed to send Meta lead to main Telegram.' });
        }
      } else {
        // === Обычная заявка с лендинга (отправляем только в СТАРЫЙ чат) ===
        const { name, phone, productName } = body;
        if (!name || !phone) {
          return response
            .status(400)
            .json({ message: 'Name and phone are required.' });
        }

        const source = productName || 'Лендинг';
        let message = `<b>🔔 Новая заявка!</b>\n\n`;
        message += `<b>Источник:</b> ${escapeHtml(source)}\n`;
        message += `<b>Имя клиента:</b> ${escapeHtml(name)}\n`;
        message += `<b>📞 Основной номер:</b> ${escapeHtml(phone)}\n`;

        const telegramResult = await sendTelegramMessage(OLD_CHAT_ID, message);

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
