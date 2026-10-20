const { createLogger } = require('../utils/logger');
const { isWebUrl, plainMessage } = require('./telegramFormat');

// Sends notifications through ntfy and/or Telegram (configured in .env).
// With no channel configured it only prints to the console.
class Notifier {
  constructor(env = process.env) {
    this.log = createLogger('Notifier');
    this.ntfyTopic = env.NTFY_TOPIC || null;
    this.ntfyServer = (env.NTFY_SERVER || 'https://ntfy.sh').replace(/\/$/, '');
    this.telegramToken = env.TELEGRAM_BOT_TOKEN || null;
    this.telegramChatId = env.TELEGRAM_CHAT_ID || null;
  }

  describeChannels() {
    const channels = [];
    if (this.ntfyTopic) channels.push('ntfy');
    if (this.telegramToken && this.telegramChatId) channels.push('Telegram');
    return channels.length ? channels.join(', ') : 'none (console only)';
  }

  async send({ title, message, url, html }) {
    this.log.info(`${title} - ${message}${url ? ` - ${url}` : ''}`);

    await Promise.all([
      this.sendNtfy({ title, message, url }),
      this.sendTelegram({ title, message, url, html })
    ]);
  }

  async sendNtfy({ title, message, url }) {
    if (!this.ntfyTopic) return;

    try {
      const response = await fetch(`${this.ntfyServer}/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: this.ntfyTopic,
          title,
          message,
          click: url || undefined,
          priority: 4
        })
      });

      if (!response.ok) this.log.warn(`ntfy: response ${response.status}`);
    } catch (error) {
      this.log.warn(`ntfy failed: ${error.message}`);
    }
  }

  // html: optional Telegram-specific version of the message (see telegramFormat.js).
  async sendTelegram({ title, message, url, html }) {
    if (!this.telegramToken || !this.telegramChatId) return;

    try {
      const body = {
        chat_id: this.telegramChatId,
        text: html || plainMessage(title, message),
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true }
      };
      if (isWebUrl(url)) body.reply_markup = { inline_keyboard: [[{ text: 'Open listing ↗', url }]] };

      const response = await fetch(
        `https://api.telegram.org/bot${this.telegramToken}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        }
      );

      if (!response.ok) {
        const { description } = await response.json().catch(() => ({}));
        this.log.warn(`Telegram: response ${response.status}${description ? ` (${description})` : ''}`);
      }
    } catch (error) {
      this.log.warn(`Telegram failed: ${error.message}`);
    }
  }
}

module.exports = { Notifier };
