// Håndskrevne typer som speiler docs/api.md. Endres kontrakten, endres disse først.

export type TitleType = 'MOVIE' | 'SERIES';
export type SortField = 'RELEVANCE' | 'RATING' | 'YEAR' | 'TITLE';
export type SortDirection = 'ASC' | 'DESC';

export interface SortInput {
  field: SortField;
  direction?: SortDirection;
}

export interface SearchFilters {
  genres?: string[];
  decades?: number[];
  types?: TitleType[];
  minRating?: number;
  availableOnly?: boolean;
}

export interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

export interface Review {
  __typename?: 'Review';
  id: string;
  titleId: string;
  author: string;
  rating: number;
  text: string;
  createdAt: string;
  isMine: boolean;
}

export interface Connection<T> {
  edges: { cursor: string; node: T }[];
  pageInfo: PageInfo;
  totalCount: number;
}

/** Feltene som trengs for å vise en tittel i en liste. */
export interface TitleSummary {
  __typename?: 'Title';
  id: string;
  primaryTitle: string;
  type: TitleType;
  startYear: number | null;
  genres: string[];
  averageRating: number | null;
  numVotes: number;
  /** Plakat i to bredder (for srcset). null når TMDB mangler bildet. */
  poster185: string | null;
  poster342: string | null;
  /** Bare url hentes i lister; nok til å vise «Se nå»-merket uten å dra med lisensfeltene. */
  stream: { url: string } | null;
}

/** Lovlig gratisversjon fra Internet Archive (se docs/api.md). */
export interface Stream {
  __typename?: 'Stream';
  url: string;
  archiveUrl: string;
  license: string;
  licenseUrl: string | null;
  durationSeconds: number | null;
  subtitlesUrl: string | null;
}

/** Tittel med feltene heltebanneret trenger i tillegg. */
export interface FeaturedTitle extends TitleSummary {
  overview: string | null;
  backdrop780: string | null;
  backdrop1280: string | null;
  inMyList: boolean;
}

export interface TitleDetails extends TitleSummary {
  overview: string | null;
  poster500: string | null;
  backdrop780: string | null;
  backdrop1280: string | null;
  originalTitle: string;
  endYear: number | null;
  runtimeMinutes: number | null;
  userRating: number | null;
  reviewCount: number;
  inMyList: boolean;
  reviews: Connection<Review>;
  stream: Stream | null;
}

/** Det spillersiden trenger. */
export interface WatchTitle {
  __typename?: 'Title';
  id: string;
  primaryTitle: string;
  startYear: number | null;
  runtimeMinutes: number | null;
  backdrop780: string | null;
  stream: Stream | null;
}

export interface FacetCount {
  value: string;
  count: number;
}

export interface Facets {
  genres: FacetCount[];
  decades: FacetCount[];
  types: FacetCount[];
  available: number;
}

export interface SearchData {
  search: Connection<TitleSummary>;
}
export interface SearchVars {
  query: string | null;
  filters?: SearchFilters;
  sort?: SortInput;
  first: number;
  after?: string | null;
}

/** Forsideradene ber ikke om `totalCount` (se ROW_QUERY). */
type WithoutCount<T> = Omit<Connection<T>, 'totalCount'>;

export interface RowData {
  search: WithoutCount<TitleSummary>;
}

export interface FeaturedData {
  search: WithoutCount<FeaturedTitle>;
}

export interface FacetsData {
  facets: Facets;
}
export interface FacetsVars {
  query: string | null;
  filters?: SearchFilters;
}

export interface GenresData {
  genres: string[];
}

export interface TitleData {
  title: TitleDetails | null;
}
export interface TitleVars {
  id: string;
  first: number;
  after?: string | null;
}

export interface WatchData {
  title: WatchTitle | null;
}
export interface WatchVars {
  id: string;
}

export interface MyListData {
  myList: Connection<TitleSummary>;
}
export interface MyListVars {
  first: number;
  after?: string | null;
}

export interface AddReviewData {
  addReview: Review;
}
export interface AddReviewVars {
  input: { titleId: string; author: string; rating: number; text: string };
}

export interface DeleteReviewData {
  deleteReview: {
    deletedId: string;
    title: { __typename?: 'Title'; id: string; userRating: number | null; reviewCount: number };
  };
}
export interface DeleteReviewVars {
  id: string;
}

export interface ToggleListData {
  toggleList: { __typename?: 'Title'; id: string; inMyList: boolean };
}
export interface ToggleListVars {
  titleId: string;
}
