import { TIME_ZONE, type IsoDate, type YearMonth } from '../shared/contract.ts';

// Display formatting only: every amount shown is calculated and stored by the backend.

const gbp = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const formatGBP = (pence: number) => gbp.format(pence / 100);

/** Exchange rates keep their precision: "£2,543.21", "£0.7912". */
export const formatRate = (rateGbp: string) =>
  new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 2,
    maximumFractionDigits: Number(rateGbp) < 1 ? 6 : 2,
  }).format(Number(rateGbp));

export const formatDate = (isoDate: IsoDate) =>
  new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${isoDate}T12:00:00Z`));

export const formatMonth = (month: YearMonth) =>
  new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${month}-15T12:00:00Z`));

export const formatMonthName = (month: YearMonth) =>
  new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' })
    .format(new Date(`${month}-15T12:00:00Z`));

export const formatDateTime = (timestamp: string) =>
  new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TIME_ZONE,
  }).format(new Date(timestamp));

/** Last calendar day of a month, e.g. "2026-09" → "2026-09-30". */
export function lastDayOfMonth(month: YearMonth): IsoDate {
  const [year, monthNumber] = month.split('-').map(Number);
  const day = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return `${month}-${String(day).padStart(2, '0')}`;
}
