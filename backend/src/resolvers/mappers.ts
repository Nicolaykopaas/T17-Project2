import type { ReviewRow, TitleRow } from '../search.js';

/** Radobjektet får valgfri forhåndsberegnet inMyList (brukes av toggleList). */
export type TitleParent = TitleRow & { inMyList?: boolean };

export function mapTitle(row: TitleParent) {
  return {
    id: row.id,
    primaryTitle: row.primary_title,
    originalTitle: row.original_title,
    type: row.title_type === 'movie' ? 'MOVIE' : 'SERIES',
    startYear: row.start_year,
    endYear: row.end_year,
    runtimeMinutes: row.runtime_minutes,
    genres: row.genres,
    averageRating: row.average_rating === null ? null : Number(row.average_rating),
    numVotes: row.num_votes,
    inMyList: row.inMyList,
  };
}

export type TitleNode = ReturnType<typeof mapTitle>;

export function mapReview(row: ReviewRow, userId: string | null) {
  return {
    id: row.id,
    titleId: row.title_id,
    author: row.author,
    rating: row.rating,
    text: row.body,
    createdAt: row.created_at.toISOString(),
    isMine: userId !== null && row.user_id === userId,
  };
}
