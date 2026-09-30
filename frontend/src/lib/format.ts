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
