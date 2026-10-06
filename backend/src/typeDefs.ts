// Speiler GraphQL-kontrakten i docs/api.md. Endringer gjøres i docs/api.md først.
export const typeDefs = /* GraphQL */ `
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
    # Bilder og handling fra TMDB (se «Bilder» i docs/api.md). null når TMDB mangler tittelen,
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
    # query: tom/null = alle titler. Case- og aksentuavhengig delstrengsøk («amelie» finner «Amélie»)
    # i primær- og originaltittel. Søk på 1–2 tegn er ordprefiks («ma» finner «The Matrix») og rangeres etter popularitet.
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
`;
