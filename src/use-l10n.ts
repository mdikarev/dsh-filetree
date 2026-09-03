// src/use-l10n.ts
import { useSyncExternalStore } from "react";
import {
  getLocale,
  getMessage,
  subscribeLocale,
  type L10nKey,
  type Locale,
} from "./l10n.js";

export function useL10n(): { locale: Locale; t: (key: L10nKey) => string } {
  const locale = useSyncExternalStore(subscribeLocale, getLocale, getLocale);
  const t = (key: L10nKey): string => getMessage(locale, key);
  return { locale, t };
}
