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
}

export interface TitleDetails extends TitleSummary {
  originalTitle: string;
  endYear: number | null;
  runtimeMinutes: number | null;
  userRating: number | null;
  reviewCount: number;
  inMyList: boolean;
  reviews: Connection<Review>;
}

export interface FacetCount {
  value: string;
  count: number;
}

export interface Facets {
  genres: FacetCount[];
  decades: FacetCount[];
  types: FacetCount[];
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

export interface ToggleListData {
  toggleList: { __typename?: 'Title'; id: string; inMyList: boolean };
}
export interface ToggleListVars {
  titleId: string;
}
