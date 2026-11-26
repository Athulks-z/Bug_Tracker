const pool = require('../config/db');

const SETTINGS_CACHE_MS = 30000;
const DEFAULT_EMAIL_EVENTS = Object.freeze({
  task_assigned: true,
  task_blocked: true,
  assignment_rejected: true,
  project_closed: true,
  announcement: true
});

let cachedSettings;
let cachedAt = 0;
let loadPromise;

function defaultSettings() {
  return {
    emailEnabled: true,
    emailEvents: { ...DEFAULT_EMAIL_EVENTS },
    inAppNotificationsEnabled: true,
    senderEmail: null
  };
}

function invalidateSettingsCache() {
  cachedAt = 0;
  cachedSettings = undefined;
  loadPromise = undefined;
}

async function getSettings({ forceRefresh = false } = {}) {
  if (!forceRefresh && cachedSettings && Date.now() - cachedAt < SETTINGS_CACHE_MS) return cachedSettings;
  if (!forceRefresh && loadPromise) return loadPromise;

  loadPromise = pool.query('SELECT key,value FROM public.app_settings')
    .then(({ rows }) => {
      const values = new Map(rows.map((row) => [row.key, row.value]));
      const settings = defaultSettings();
      const enabled = values.get('email_enabled');
      const events = values.get('email_events');
      const inApp = values.get('in_app_notifications_enabled');
      const sender = values.get('sender_email');
      if (typeof enabled === 'boolean') settings.emailEnabled = enabled;
      if (events && typeof events === 'object' && !Array.isArray(events)) {
        settings.emailEvents = { ...DEFAULT_EMAIL_EVENTS, ...events };
      }
      if (typeof inApp === 'boolean') settings.inAppNotificationsEnabled = inApp;
      if (typeof sender === 'string' && sender.trim()) settings.senderEmail = sender.trim().toLowerCase();
      cachedSettings = settings;
      cachedAt = Date.now();
      return settings;
    })
    .finally(() => { loadPromise = undefined; });
  return loadPromise;
}

async function isEmailEnabled(eventType) {
  const settings = await getSettings();
  return settings.emailEnabled && settings.emailEvents[eventType] !== false;
}

async function getSenderEmail() {
  const settings = await getSettings();
  return settings.senderEmail || process.env.MS_SENDER || '';
}

module.exports = {
  DEFAULT_EMAIL_EVENTS,
  defaultSettings,
  getSettings,
  getSenderEmail,
  isEmailEnabled,
  invalidateSettingsCache
};
