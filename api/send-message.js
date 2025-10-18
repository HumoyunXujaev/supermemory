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
        }

        // === Запрашиваем данные лида через Graph API ===
        const token = process.env.META_PAGE_ACCESS_TOKEN;
        const leadResponse = await fetch(
          `https://graph.facebook.com/v23.0/${leadgenId}?access_token=${token}`
        );
        const leadJson = await leadResponse.json();
        console.log('=== LEAD DATA FROM GRAPH API ===', leadJson);

        const leadData = leadJson.field_data || [];
        const findField = (fieldName) =>
          leadData.find((f) => f.name === fieldName)?.values?.[0] || 'не указано';

        // <--- ИЗМЕНЕНИЕ 1: Добавляем проверку новых полей (узб.) ---
        // Имя
        let name = findField('full_name');
        if (name === 'не указано') {
          name = findField('исмингиз?'); // Поиск по узбекскому названию поля
        }

        const firstName = findField('first_name');
        const lastName = findField('last_name');
        if (name === 'не указано' && (firstName !== 'не указано' || lastName !== 'не указано')) {
          name = `${firstName} ${lastName}`.trim();
        }

        // Телефоны
        let phoneMain = findField('phone_number');
        if (phoneMain === 'не указано') {
            phoneMain = findField('телефон_рақамингиз?'); // Поиск по узбекскому названию поля
        }

        const phoneExtra = findField('biz_sizga_telefon_qilishimiz_uchun,_raqamingizni_qoldiring.');
        const phoneUzbek = findField('телефон_рақамингиз?'); // Также получаем это поле
        // <--- КОНЕЦ ИЗМЕНЕНИЯ 1 ---

        // === Определяем продукт и флаг новой формы ===
        let productName;
        let isNewForm = false;

        // <--- ИЗМЕНЕНИЕ 2: Меняем логику определения новой формы ---
        // Если формы НЕТ в старом списке, считаем ее НОВОЙ
        if (FORM_NAMES[formId]) {
          productName = FORM_NAMES[formId];
          isNewForm = false;
        } else {
          // Это НЕ старая форма, значит - новая.
          isNewForm = true;
          // Пытаемся найти название в новом списке, или ставим "Неизвестный"
          productName = NEW_FORM_NAMES[formId] || 'Неизвестный продукт';
        }
        // <--- КОНЕЦ ИЗМЕНЕНИЯ 2 ---
        
        // === Готовим базовые части сообщения ===
        const namePart = `<b>Имя клиента:</b> ${escapeHtml(name)}\n`;
        const phoneMainPart = `<b>📞 Основной номер:</b> ${escapeHtml(phoneMain)}\n`;
        
        let phoneExtraPart = '';
        // <--- ИЗМЕНЕНИЕ 3: Улучшаем логику доп. номера ---
        // Проверяем старое поле доп. номера
        if (phoneExtra && phoneExtra !== 'не указано' && phoneExtra !== phoneMain) {
          phoneExtraPart = `<b>📞 Доп. номер:</b> ${escapeHtml(phoneExtra)}\n`;
        } 
        // Если его нет, проверяем новое узбекское поле (вдруг оно отличается от основного)
        else if (phoneUzbek && phoneUzbek !== 'не указано' && phoneUzbek !== phoneMain) {
          phoneExtraPart = `<b>📞 Доп. номер:</b> ${escapeHtml(phoneUzbek)}\n`;
        }
        // <--- КОНЕЦ ИЗМЕНЕНИЯ 3 ---

        // === 1. Отправка в СТАРЫЙ чат ===
        const sourceForOldChat = `Meta Lead Ad (${isNewForm ? '*' : ''}${productName}${isNewForm ? '*' : ''}, Form ID: ${formId})`;
        const messageForOldChat = `<b>🔔 Новая заявка!</b>\n\n` +
          `<b>Источник:</b> ${escapeHtml(sourceForOldChat)}\n` +
          namePart +
          phoneMainPart +
          phoneExtraPart;
      
        const telegramResult1 = await sendTelegramMessage(OLD_CHAT_ID, messageForOldChat);

        // === 2. Отправка в НОВЫЙ чат (только если форма новая) ===
        if (isNewForm) {
          const sourceForNewChat = `Meta Lead Ad (${productName}, Form ID: ${formId})`; // Без звезды
          const messageForNewChat = `<b>🔔 Новая заявка!</b>\n\n` +
            `<b>Источник:</b> ${escapeHtml(sourceForNewChat)}\n` +
            namePart +
            phoneMainPart +
            phoneExtraPart;
          
          // Отправляем во второй чат, но не ждем ответа, чтобы не блокировать основной
          sendTelegramMessage(NEW_CHAT_ID, messageForNewChat).catch(err => {
            console.error('Failed to send message to NEW chat:', err);
          });
        }

        // Отвечаем серверу Meta на основе результата *первой* отправки
        if (telegramResult1.ok) {
          return response.status(200).json({ message: 'Meta lead processed successfully!' });
        } else {
          return response.status(500).json({ message: 'Failed to send Meta lead to main Telegram.' });
        }
      } else {
        // === Обычная заявка с лендинга (отправляем только в СТАРЫЙ чат) ===
        const { name, phone, productName } = body;
        if (!name || !phone) {
          return response.status(400).json({ message: 'Name and phone are required.' });
        }

        const source = productName || 'Лендинг';
        
        let message = `<b>🔔 Новая заявка!</b>\n\n`;
        message += `<b>Источник:</b> ${escapeHtml(source)}\n`;
        message += `<b>Имя клиента:</b> ${escapeHtml(name)}\n`;
        message += `<b>📞 Основной номер:</b> ${escapeHtml(phone)}\n`;

        const telegramResult = await sendTelegramMessage(OLD_CHAT_ID, message);

        if (telegramResult.ok) {
          return response.status(200).json({ message: 'Landing page lead processed successfully!' });
        } else {
          return response.status(500).json({ message: 'Failed to send landing page lead to Telegram.' });
        }
      }
    } catch (error) {
      console.error('Error processing POST request:', error);
      return response.status(500).json({ message: 'Internal Server Error.' });
    }
  }

  return response.status(405).json({ message: `Method ${request.method} Not Allowed` });
}
