const { createLogger } = require('../utils/logger');

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

  async send({ title, message, url }) {
    this.log.info(`${title} - ${message}${url ? ` - ${url}` : ''}`);

    await Promise.all([
      this.sendNtfy({ title, message, url }),
      this.sendTelegram({ title, message, url })
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

  async sendTelegram({ title, message, url }) {
    if (!this.telegramToken || !this.telegramChatId) return;

    try {
      const text = [title, message, url].filter(Boolean).join('\n');
      const response = await fetch(
        `https://api.telegram.org/bot${this.telegramToken}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: this.telegramChatId, text })
        }
      );

      if (!response.ok) this.log.warn(`Telegram: response ${response.status}`);
    } catch (error) {
      this.log.warn(`Telegram failed: ${error.message}`);
    }
  }
}

module.exports = { Notifier };
