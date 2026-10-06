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
  availableOnly: Boolean # bare titler med stream
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
  # Bilder og handling fra TMDB (se «Bilder» under). null når TMDB mangler tittelen,
  # når TMDB_API_KEY ikke er satt, eller når oppslaget feiler/tar for lang tid.
  overview: String # engelsk handlingsbeskrivelse
  posterUrl(width: Int = 342): String # 2:3; bredde snappes til 92, 154, 185, 342, 500 eller 780
  backdropUrl(width: Int = 1280): String # 16:9; bredde snappes til 300, 780 eller 1280
  stream: Stream # lovlig gratisversjon fra Internet Archive, null hvis ingen
}

type Stream {
  url: String! # direkte videofil (MP4/WebM) som nettleseren kan spille, støtter Range-requests
  archiveUrl: String! # siden på archive.org (kilde)
  license: String! # f.eks. "Public Domain" eller "CC BY 4.0"
  licenseUrl: String
  durationSeconds: Int
  subtitlesUrl: String # WebVTT, bare hvis Internet Archive har en .vtt-fil
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
  available: Int! # antall treff med stream, med alle andre filtre aktive
}

input AddReviewInput {
  titleId: ID!
  author: String!
  rating: Int!
  text: String!
}

type DeleteReviewPayload {
  deletedId: ID! # id-en som ble slettet; frontend fjerner Review:<id> fra cachen
  title: Title! # tittelen med oppdaterte userRating og reviewCount
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
  # Sletter bare brukerens egne anmeldelser. Andres og ukjente id-er gir begge NOT_FOUND.
  deleteReview(id: ID!): DeleteReviewPayload!
}
```

## Regler

- `first` må være 1–50, ellers `BAD_USER_INPUT`. `query` maks 200 tegn. Spørredybde maks 6.
- Cursorer er ugjennomsiktige strenger (base64). Ugyldig cursor gir `BAD_USER_INPUT`.
- Feil returneres som GraphQL-feil med `extensions.code`: `BAD_USER_INPUT`, `NOT_FOUND`,
  `UNAUTHENTICATED` (mangler `x-user-id` på mutation), `RATE_LIMITED` (se under),
  `INTERNAL_SERVER_ERROR` (uten detaljer).
- Maks 8 rotfelt (aliaser telles hver for seg) og 150 felt totalt per operasjon (fragmenter
  ekspandert), ellers `BAD_USER_INPUT`. Frontendens største spørring har ca. 45 felt.
- `deleteReview(id)`: `id` må være heltallsstrengen fra `Review.id` (ellers `BAD_USER_INPUT`).
  Hører anmeldelsen til en annen `x-user-id`, eller finnes den ikke, er svaret likt: `NOT_FOUND`
  («Fant ikke anmeldelsen.»). Svaret har `deletedId` (fjern `Review:<id>` fra Apollo-cachen) og
  `title` med nye `userRating`/`reviewCount`, som oppdaterer `Title:<id>` i cachen automatisk.
- Begrensning av mutations (token bucket i prosessminnet, per `x-user-id` og per IP, se
  `docs/beslutninger.md`): `addReview` maks 10 per minutt per bruker, `toggleList` og `deleteReview`
  maks 60 per minutt per bruker; IP-grensen er tre ganger så høy. Over grensen gir `RATE_LIMITED`
  med `extensions.retryAfterSeconds` og meldingen «For mange forsøk. Vent N sekunder og prøv igjen.»
- All søk, filtrering, sortering og paginering skjer i SQL.

## Bilder (TMDB)

- IMDb-datasettene har ingen bilder. Backenden slår opp `/find/{imdbId}?external_source=imdb_id`
  hos TMDB første gang en tittel trenger bilde, og lagrer svaret (også «finnes ikke») i databasen.
  Etterpå hentes bildene aldri fra TMDB-API-et igjen for den tittelen.
- Bilde-URL-ene peker direkte til TMDBs bilde-CDN (`TMDB_IMAGE_URL`, standard
  `https://image.tmdb.org/t/p`). Backenden proxyer ikke bildene.
- Oppslag skjer samlet per request (én side med titler = ett DB-oppslag + parallelle TMDB-kall
  med begrenset samtidighet). Et søk skal aldri vente mer enn ca. 2,5 s på bilder; titler som ikke
  rakk å bli slått opp får `null` i denne responsen og prøves igjen senere.
- Miljøvariabler: `TMDB_API_KEY` (v3-nøkkel eller v4-token), `TMDB_API_URL` (standard
  `https://api.themoviedb.org/3`), `TMDB_IMAGE_URL`. I utvikling og E2E brukes en lokal
  falsk TMDB-server (`npm run tmdb:mock -w backend`) som lager plakater som SVG.

## Strømming (Internet Archive)

- Bare filmer Internet Archive markerer som fri bruk: `licenseurl` er Creative Commons eller
  public domain, eller elementet ligger i en kuratert public domain-samling (se
  `docs/beslutninger.md`). Alt annet hoppes over.
- `npm run db:archive` henter kandidater fra Internet Archive, kobler dem til IMDb-titler (IMDb-ID
  i metadata, ellers entydig treff på normalisert tittel og år ±1) og lagrer én spillbar fil per
  tittel i `title_streams`. Idempotent.
- Videoen strømmes direkte fra archive.org. Vi lagrer eller proxyer ingen video.
- `ARCHIVE_URL` (standard `https://archive.org`) kan pekes mot den falske serveren
  (`npm run archive:mock -w backend`) i utvikling og E2E.
