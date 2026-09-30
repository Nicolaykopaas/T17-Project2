# GraphQL-API – kontrakt

Denne fila er kontrakten mellom backend og frontend. Endringer skal gjøres her først.

- Endepunkt: `POST /graphql` på port 3001. I produksjon og i Vite-dev når frontend det via
  `/project2/graphql`.
- Anonym bruker: frontend lager en UUID v4 én gang, lagrer den i `localStorage` og sender den i
  headeren `x-user-id` på alle requests. Backend avviser ugyldige UUID-er (behandles som «ingen
  bruker»). Mutations krever gyldig `x-user-id`.

```graphql
enum TitleType {
  MOVIE
  SERIES
}

enum SortField {
  RELEVANCE # likhet med søketeksten; uten søketekst: flest stemmer først
  RATING
  YEAR
  TITLE
}

enum SortDirection {
  ASC
  DESC
}

input SortInput {
  field: SortField!
  # Standard: RELEVANCE DESC, RATING DESC, YEAR DESC, TITLE ASC
  direction: SortDirection
}

input SearchFilters {
  genres: [String!] # tittelen må ha ALLE valgte sjangre
  decades: [Int!] # f.eks. 1990 = 1990–1999; flere tiår = ELLER
  types: [TitleType!] # flere typer = ELLER
  minRating: Float # 0–10
}

type PageInfo {
  hasNextPage: Boolean!
  endCursor: String
}

type Review {
  id: ID!
  titleId: ID!
  author: String! # visningsnavn, 1–50 tegn
  rating: Int! # 1–5
  text: String! # 0–2000 tegn
  createdAt: String! # ISO 8601
  isMine: Boolean! # skrevet av x-user-id
}

type ReviewEdge {
  cursor: String!
  node: Review!
}

type ReviewConnection {
  edges: [ReviewEdge!]!
  pageInfo: PageInfo!
  totalCount: Int!
}

type Title {
  id: ID! # IMDb tconst, f.eks. "tt0111161"
  primaryTitle: String!
  originalTitle: String!
  type: TitleType!
  startYear: Int
  endYear: Int
  runtimeMinutes: Int
  genres: [String!]!
  averageRating: Float # IMDb-snitt 1–10
  numVotes: Int!
  userRating: Float # snitt av anmeldelser i vår app (1–5), null uten anmeldelser
  reviewCount: Int!
  inMyList: Boolean!
  reviews(first: Int = 10, after: String): ReviewConnection! # nyeste først
}

type TitleEdge {
  cursor: String!
  node: Title!
}

type TitleConnection {
  edges: [TitleEdge!]!
  pageInfo: PageInfo!
  totalCount: Int!
}

type FacetCount {
  value: String! # sjangernavn, tiår som tekst ("1990") eller TitleType-navn ("MOVIE")
  count: Int!
}

type Facets {
  genres: [FacetCount!]!
  decades: [FacetCount!]!
  types: [FacetCount!]!
}

input AddReviewInput {
  titleId: ID!
  author: String!
  rating: Int!
  text: String!
}

type Query {
  # query: tom/null = alle titler. Case-insensitivt delstrengsøk i primær- og originaltittel.
  search(
    query: String
    filters: SearchFilters
    sort: SortInput
    first: Int = 20
    after: String
  ): TitleConnection!
  title(id: ID!): Title
  # Antall treff per verdi. Hver dimensjon telles med alle ANDRE filtre aktive (vanlig
  # fasettsøk), slik at brukeren ser hva hun får ved å legge til/bytte en verdi.
  facets(query: String, filters: SearchFilters): Facets!
  myList(first: Int = 20, after: String): TitleConnection! # sist lagt til først
  genres: [String!]! # alle sjangre, alfabetisk
}

type Mutation {
  addReview(input: AddReviewInput!): Review!
  toggleList(titleId: ID!): Title! # returnerer tittelen med oppdatert inMyList
}
```

## Regler

- `first` må være 1–50, ellers `BAD_USER_INPUT`. `query` maks 200 tegn. Spørredybde maks 6.
- Cursorer er ugjennomsiktige strenger (base64). Ugyldig cursor gir `BAD_USER_INPUT`.
- Feil returneres som GraphQL-feil med `extensions.code`: `BAD_USER_INPUT`, `NOT_FOUND`,
  `UNAUTHENTICATED` (mangler `x-user-id` på mutation), `INTERNAL_SERVER_ERROR` (uten detaljer).
- All søk, filtrering, sortering og paginering skjer i SQL.
