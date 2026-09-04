// src/l10n.ts
// Plugin-local minimal i18n: en is the default and the source of truth;
// ru is preserved and auto-selected for ru-locale browsers. The DSH host
// ships only zh/en locales, so the plugin cannot rely on it for Russian.
// Pure module: no top-level browser access (Node-test safe). React lives
// in src/use-l10n.ts.
// The module-level default is always "en" (deterministic, Node-test safe);
// the browser locale is applied explicitly from storage/navigator via
// initBrowserLocale(), which attachBrowserLocaleSync() calls on attach.

export type Locale = "en" | "ru";

export const LOCALE_STORAGE_KEY = "fm-locale";

const en = {
  filesFallback: "Files",
  refresh: "Refresh",
  close: "Close",
  openFiles: "Open files",
  closePanel: "Close panel",
  emptyFolder: "Empty folder",
  loading: "Loading…",
  errorPrefix: "Error: ",
  retry: "Retry",
  noWorkspace: "No workspace",
  liveFallback: "Auto-refresh: polling directories (SSE unavailable)",
  liveRefreshUnavailable: "Live refresh unavailable — retrying automatically",
  markdownMode: "Markdown mode",
  sourceMode: "Source",
  renderedMode: "Preview",
  fileChanged: "File changed on disk",
  update: "Update",
  keepCurrent: "Keep current version",
  previewUnavailablePrefix: "Preview unavailable: ",
  zoomIn: "Zoom in",
  zoomOut: "Zoom out",
  zoomFit: "Fit to panel",
  zoomOriginal: "Actual size (100%)",
  imageToolbar: "Image tools",
  openOriginal: "Open original in a new tab",
  imageLoadFailed: "Image failed to load.",
  imageTooLarge: "Very large image — zoomed out; open the original for details.",
  jsonMode: "JSON mode",
  rawMode: "Raw",
  prettyMode: "Formatted",
  jsonParseNote: "Invalid JSON — showing the raw source.",
  jsonTooLargeNote: "File too large to format — showing the raw source.",
  fileTruncated: "File truncated at 5 MB; not all content is shown.",
  deleteMenuItem: "Delete…",
  deleteDialogTitle: "Delete",
  deleteFileBody: "Delete {name}?",
  deleteFolderBody: "Delete {name} and all its contents?",
  deleteUncommittedWarning: "Uncommitted git changes inside will be lost.",
  cancel: "Cancel",
  deleteAction: "Delete",
  deleteBlocked: "Nothing to delete.",
  deleteErrorPrefix: "Delete failed: ",
} as const;

export type L10nKey = keyof typeof en;

const ru: Record<L10nKey, string> = {
  filesFallback: "Файлы",
  refresh: "Обновить",
  close: "Закрыть",
  openFiles: "Открыть файлы",
  closePanel: "Закрыть панель",
  emptyFolder: "Пустая папка",
  loading: "Загрузка…",
  errorPrefix: "Ошибка: ",
  retry: "Повторить",
  noWorkspace: "Нет воркспейса",
  liveFallback: "Автообновление: опрос каталогов (SSE недоступен)",
  liveRefreshUnavailable: "Автообновление недоступно — повтор подключения",
  markdownMode: "Режим Markdown",
  sourceMode: "Исходник",
  renderedMode: "Предпросмотр",
  fileChanged: "Файл изменён на диске",
  update: "Обновить",
  keepCurrent: "Оставить текущую версию",
  previewUnavailablePrefix: "Предпросмотр недоступен: ",
  zoomIn: "Приблизить",
  zoomOut: "Отдалить",
  zoomFit: "По размеру панели",
  zoomOriginal: "Реальный размер (100%)",
  imageToolbar: "Инструменты изображения",
  openOriginal: "Открыть оригинал в новой вкладке",
  imageLoadFailed: "Не удалось загрузить изображение.",
  imageTooLarge: "Очень большое изображение — уменьшено; для деталей откройте оригинал.",
  jsonMode: "Режим JSON",
  rawMode: "Исходник",
  prettyMode: "Форматированный",
  jsonParseNote: "Некорректный JSON — показан исходный текст.",
  jsonTooLargeNote: "Файл слишком велик для форматирования — показан исходный текст.",
  fileTruncated: "Файл усечён до 5 МБ; показано не всё содержимое.",
  deleteMenuItem: "Удалить…",
  deleteDialogTitle: "Удалить",
  deleteFileBody: "Удалить {name}?",
  deleteFolderBody: "Удалить {name} и всё его содержимое?",
  deleteUncommittedWarning: "Незакоммиченные изменения git внутри будут потеряны.",
  cancel: "Отмена",
  deleteAction: "Удалить",
  deleteBlocked: "Удалять нечего.",
  deleteErrorPrefix: "Не удалось удалить: ",
};

export function detectLocale(navigatorLanguage: string, stored: string | null): Locale {
  if (stored === "en" || stored === "ru") return stored;
  const subtag = (navigatorLanguage ?? "").toLowerCase().split("-")[0] ?? "";
  return subtag === "ru" ? "ru" : "en";
}

export function getMessage(locale: Locale, key: L10nKey): string {
  return (locale === "ru" ? ru : en)[key];
}

function readStored(): string | null {
  try {
    if (typeof localStorage !== "undefined") return localStorage.getItem(LOCALE_STORAGE_KEY);
  } catch {
    // storage unavailable (private mode / tests)
  }
  return null;
}

function navigatorLanguage(): string {
  try {
    return typeof navigator !== "undefined" ? navigator.language : "";
  } catch {
    return "";
  }
}

// Deterministic default: in Node >= 21, navigator.language reflects LANG, so
// reading it at import time would load the module as "ru" on ru-locale machines
// and make tests env-sensitive. The browser locale is applied later via
// initBrowserLocale().
let currentLocale: Locale = "en";
const listeners = new Set<() => void>();

export function getLocale(): Locale {
  return currentLocale;
}

export function setLocale(locale: Locale): void {
  if (locale === currentLocale) return;
  currentLocale = locale;
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // storage unavailable
  }
  for (const listener of [...listeners]) listener();
}

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function initBrowserLocale(): Locale {
  const locale = detectLocale(navigatorLanguage(), readStored());
  if (locale !== currentLocale) {
    currentLocale = locale;
    for (const listener of [...listeners]) listener();
  }
  return locale;
}

export function t(key: L10nKey): string {
  return getMessage(currentLocale, key);
}

export function attachBrowserLocaleSync(): void {
  if (typeof window === "undefined") return;
  initBrowserLocale();
  window.addEventListener("storage", (event) => {
    if (event.key !== LOCALE_STORAGE_KEY) return;
    const next = detectLocale(navigatorLanguage(), event.newValue);
    if (next !== currentLocale) {
      currentLocale = next;
      for (const listener of [...listeners]) listener();
    }
  });
}
