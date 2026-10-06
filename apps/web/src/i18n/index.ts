/**
 * Übersetzungen der Oberfläche. Quelltexte sind deutsch; `t()` liefert die
 * Übersetzung in der eingestellten Sprache (Mechanik siehe `@satis/core`).
 */
import { formatNumber, getLanguage, numberLocale, registerTranslations, tr } from '@satis/core';
import { UI_EN } from './en';

registerTranslations('en', UI_EN);

export const t = tr;

/** Markiert einen deutschen Text zur Übersetzung, ohne ihn sofort zu übersetzen (Anzeige später mit t()). */
export const N_ = (s: string): string => s;
export { formatNumber, getLanguage, numberLocale };
