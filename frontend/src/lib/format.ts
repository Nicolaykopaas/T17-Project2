import type { TitleSummary, TitleType } from '../graphql/types';

const numberFormat = new Intl.NumberFormat('nb-NO');
const ratingFormat = new Intl.NumberFormat('nb-NO', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export const formatNumber = (n: number) => numberFormat.format(n);
export const formatRating = (n: number) => ratingFormat.format(n);

export function typeLabel(type: TitleType | string): string {
  if (type === 'MOVIE') return 'Film';
  if (type === 'SERIES') return 'Serie';
  return type;
}

export const decadeLabel = (decade: string | number) => `${decade}-tallet`;

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('nb-NO', { year: 'numeric', month: 'long', day: 'numeric' });
}

export function formatYears(title: Pick<TitleSummary, 'startYear'> & { endYear?: number | null }) {
  if (title.startYear == null) return 'Ukjent år';
  if (title.endYear != null && title.endYear !== title.startYear) {
    return `${title.startYear}–${title.endYear}`;
  }
  return String(title.startYear);
}

/** Deterministisk fargetone (0–359) fra id, så plassholderen til en tittel alltid ser lik ut. */
export function hueFromId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return hash % 360;
}

/** Kutter ved ordgrense så handlingsteksten passer over bildet uten «vis mer». */
export function truncate(text: string, max = 220): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return cut.slice(0, space > 80 ? space : max).trimEnd() + '…';
}

/** «12:03» eller «1:32:10». Ugyldige verdier (NaN, Infinity, negative) vises som 0:00. */
export function formatClock(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}
