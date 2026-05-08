/**
 * App-wide constants
 */

export const APP_VERSION = '2.0.1';
export const APP_NAME = 'HIVALINE';

export const MIN_TOUCH_TARGET = 44;

export const SERVER_CODE_REGEX = /^HIVA-[A-Z0-9]{4}$/;
export const ACCESS_KEY_REGEX = /^[A-Z0-9]{4}$/;

export const MIN_WEIGHT_KG = 3;
export const MAX_WEIGHT_KG = 60;

export const SESSION_STORAGE_KEY = 'hivaline_session';

// Auth localStorage keys (persistent session)
export const HIVA_TOKEN_KEY = 'hiva_token';
export const HIVA_SERVER_CODE_KEY = 'hiva_server_code';
export const HIVA_USER_NAME_KEY = 'hiva_user_name';
export const HIVA_KNOWN_VERSION_KEY = 'hiva_known_version';
export const THEME_STORAGE_KEY = 'hivaline_theme';
export const SETTINGS_STORAGE_KEY = 'hivaline_settings';
export const TTS_STORAGE_KEY = 'hivaline_tts';

export const DEFAULT_SETTINGS = {
  language: 'en' as const,
  theme: 'light' as const,
  interactionMode: 'companion' as const,
};

export const DEFAULT_TTS_SETTINGS = {
  enabled: true,
  voiceURI: null as string | null,
};

export const STT_LANG_STORAGE_KEY = 'hivaline_stt_lang';

export const STT_LANGUAGES = [
  { code: 'en-GB', label: 'English (UK)', flag: '🇬🇧' },
  { code: 'en-NG', label: 'English (Nigeria)', flag: '🇳🇬' },
  { code: 'ha', label: 'Hausa', flag: '🇳🇬' },
  { code: 'yo', label: 'Yorùbá', flag: '🇳🇬' },
  { code: 'ig', label: 'Igbo', flag: '🇳🇬' },
] as const;
