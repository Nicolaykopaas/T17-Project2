/* eslint-disable react-refresh/only-export-components -- ruteoppsett, ikke en komponentfil */
import { lazy } from 'react';
import type { RouteObject } from 'react-router';
import { Layout } from './components/Layout';
import HomePage from './pages/HomePage';
import NotFoundPage from './pages/NotFoundPage';
import RouteError from './pages/RouteError';

// Detalj-, spiller- og listesiden er ikke nødvendige for første visning, så de lastes ved behov.
const TitlePage = lazy(() => import('./pages/TitlePage'));
const WatchPage = lazy(() => import('./pages/WatchPage'));
const MyListPage = lazy(() => import('./pages/MyListPage'));

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <Layout />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'title/:id', element: <TitlePage /> },
      { path: 'watch/:id', element: <WatchPage /> },
      { path: 'my-list', element: <MyListPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
