export default async function handler(request, response) {
  response.setHeader('Access-Control-Allow-Credentials', true);
  response.setHeader('Access-Control-Allow-Origin', 'https://europapharm.uz');
  response.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  response.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // The browser sends an OPTIONS request first to check permissions.
  // We need to handle this and send a successful response.
  if (request.method === 'OPTIONS') {
    response.status(200).end();
    return;
  }

  // We only want to handle POST requests for the actual form submission
  if (request.method !== 'POST') {
    return response.status(405).json({ message: 'Method Not Allowed' });
  }

  const { name, phone, productName } = request.body;

  // These secrets should be stored as Environment Variables, not here in the code!
  const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

  if (!TOKEN || !CHAT_ID) {
     return response.status(500).json({ message: 'Server configuration error.' });
  }

  let message = `<b>🔔 Новая заявка!</b>\n\n`;
  message += `<b>Продукт:</b> ${productName}\n`;
  message += `<b>Имя клиента:</b> ${name}\n`;
  message += `<b>Телефон:</b> ${phone}`;

  const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;

  try {
    const telegramResponse = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: message,
        parse_mode: 'html',
      }),
    });

    const data = await telegramResponse.json();

    if (!data.ok) {
      // If Telegram returned an error
      throw new Error(data.description);
    }

    // Send a success response back to the browser
    return response.status(200).json({ message: 'Success!' });

  } catch (error) {
    console.error("Error sending to Telegram:", error);
    // Send an error response back to the browser
    return response.status(500).json({ message: 'Failed to send message.' });
  }
}