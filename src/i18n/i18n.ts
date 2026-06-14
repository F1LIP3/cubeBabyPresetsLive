import { en } from './en';

export type MessageKeys = keyof typeof en;
export type Messages = typeof en;

// Current locale (default: 'en')
let currentLocale: 'en' = 'en';

// Get messages for current locale
export function getMessages(): Messages {
  return en;
}

// Translation function (placeholder for future multilingual support)
export function t(key: MessageKeys): string {
  const messages = getMessages();
  return getNestedValue(messages, key) || key.toString();
}

// Helper to get nested value from object
function getNestedValue(obj: any, path: string): string | undefined {
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current === undefined || current === null) {
      return undefined;
    }
    current = current[part];
  }
  return typeof current === 'string' ? current : undefined;
}

// Initialize i18n (can be extended for locale switching)
export function initI18n(locale: 'en' = 'en'): void {
  currentLocale = locale;
}

export { currentLocale };
