const PERSIAN_NUMBER_LOCALE = 'fa-IR-u-nu-arabext';
const PERSIAN_DATE_LOCALE = 'fa-IR-u-ca-persian-nu-arabext';

export type PersianDateOptions = Intl.DateTimeFormatOptions;

/** Converts display text only; never use this for IDs, API payloads or numeric calculations. */
export function toPersianDigits(value: string | number): string {
  return String(value).replace(/[0-9]/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);
}

/** Formats a numeric value with Persian digits and locale-aware grouping. */
export function formatPersianNumber(
  value: number,
  options: Intl.NumberFormatOptions = {},
): string {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(PERSIAN_NUMBER_LOCALE, options).format(value);
}

function parseDisplayDate(value: Date | string | number): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (dateOnly) {
      // Noon avoids accidental day changes when a date-only value is rendered in local time.
      return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]), 12);
    }
  }
  return new Date(value);
}

/** Formats a date using the Persian calendar; date-only ISO values are treated as local dates. */
export function formatPersianDate(
  value: Date | string | number,
  options: PersianDateOptions = {},
): string {
  const date = parseDisplayDate(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(PERSIAN_DATE_LOCALE, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    ...options,
  }).format(date);
}

/** Formats a date and time using the Persian calendar and Persian digits. */
export function formatPersianDateTime(
  value: Date | string | number,
  options: PersianDateOptions = {},
): string {
  const date = parseDisplayDate(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(PERSIAN_DATE_LOCALE, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...options,
  }).format(date);
}

/** Formats a currency amount for display. The currency must be an ISO 4217 code. */
export function formatPersianCurrency(
  amount: number,
  currency: string,
  options: Omit<Intl.NumberFormatOptions, 'style' | 'currency'> = {},
): string {
  if (!Number.isFinite(amount)) return '—';
  return new Intl.NumberFormat(PERSIAN_NUMBER_LOCALE, {
    style: 'currency',
    currency,
    ...options,
  }).format(amount);
}
