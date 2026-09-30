import { gql, type TypedDocumentNode } from '@apollo/client';
import type {
  AddReviewData,
  AddReviewVars,
  FacetsData,
  FeaturedData,
  FacetsVars,
  GenresData,
  MyListData,
  MyListVars,
  SearchData,
  SearchVars,
  TitleData,
  TitleVars,
  ToggleListData,
  ToggleListVars,
} from './types';

// Bevisst smal feltliste i listene: færre bytes over nettet og raskere SQL.
const SUMMARY_FIELDS = `
  id
  primaryTitle
  type
  startYear
  genres
  averageRating
  numVotes
  poster185: posterUrl(width: 185)
  poster342: posterUrl(width: 342)
`;

// Heltebanneret trenger handling og bakgrunnsbilde i to bredder (srcset).
const HERO_FIELDS = `
  overview
  backdrop780: backdropUrl(width: 780)
  backdrop1280: backdropUrl(width: 1280)
`;

export const SEARCH_QUERY: TypedDocumentNode<SearchData, SearchVars> = gql`
  query Search(
    $query: String
    $filters: SearchFilters
    $sort: SortInput
    $first: Int
    $after: String
  ) {
    search(query: $query, filters: $filters, sort: $sort, first: $first, after: $after) {
      totalCount
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        cursor
        node {
          ${SUMMARY_FIELDS}
        }
      }
    }
  }
`;

// Samme `search`-felt og cache-nøkkel som en vanlig rad, bare med flere felt. Toppraden og
// heltebanneret deler dermed én request i stedet for to.
export const FEATURED_QUERY: TypedDocumentNode<FeaturedData, SearchVars> = gql`
  query Featured(
    $query: String
    $filters: SearchFilters
    $sort: SortInput
    $first: Int
    $after: String
  ) {
    search(query: $query, filters: $filters, sort: $sort, first: $first, after: $after) {
      totalCount
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        cursor
        node {
          ${SUMMARY_FIELDS}
          ${HERO_FIELDS}
          inMyList
        }
      }
    }
  }
`;

export const FACETS_QUERY: TypedDocumentNode<FacetsData, FacetsVars> = gql`
  query Facets($query: String, $filters: SearchFilters) {
    facets(query: $query, filters: $filters) {
      genres {
        value
        count
      }
      decades {
        value
        count
      }
      types {
        value
        count
      }
    }
  }
`;

export const GENRES_QUERY: TypedDocumentNode<GenresData, Record<string, never>> = gql`
  query Genres {
    genres
  }
`;

export const TITLE_QUERY: TypedDocumentNode<TitleData, TitleVars> = gql`
  query TitleDetails($id: ID!, $first: Int, $after: String) {
    title(id: $id) {
      ${SUMMARY_FIELDS}
      ${HERO_FIELDS}
      poster500: posterUrl(width: 500)
      originalTitle
      endYear
      runtimeMinutes
      userRating
      reviewCount
      inMyList
      reviews(first: $first, after: $after) {
        totalCount
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          cursor
          node {
            id
            titleId
            author
            rating
            text
            createdAt
            isMine
          }
        }
      }
    }
  }
`;

export const MY_LIST_QUERY: TypedDocumentNode<MyListData, MyListVars> = gql`
  query MyList($first: Int, $after: String) {
    myList(first: $first, after: $after) {
      totalCount
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        cursor
        node {
          ${SUMMARY_FIELDS}
        }
      }
    }
  }
`;

export const ADD_REVIEW_MUTATION: TypedDocumentNode<AddReviewData, AddReviewVars> = gql`
  mutation AddReview($input: AddReviewInput!) {
    addReview(input: $input) {
      id
      titleId
      author
      rating
      text
      createdAt
      isMine
    }
  }
`;

export const TOGGLE_LIST_MUTATION: TypedDocumentNode<ToggleListData, ToggleListVars> = gql`
  mutation ToggleList($titleId: ID!) {
    toggleList(titleId: $titleId) {
      id
      inMyList
    }
  }
`;
