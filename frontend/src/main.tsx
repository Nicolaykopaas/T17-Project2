import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter } from 'react-router';
// Varianten fra /dom kobler på ReactDOM.flushSync, som `useSearchState` trenger (se der).
import { RouterProvider } from 'react-router/dom';
import { ApolloProvider } from '@apollo/client/react';
import { createClient } from './apollo/client';
import { routes } from './routes';
import './styles/global.css';

const client = createClient();
// BASE_URL er '/project2/'; routeren vil ha basename uten avsluttende skråstrek.
const router = createBrowserRouter(routes, {
  basename: import.meta.env.BASE_URL.replace(/\/$/, ''),
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ApolloProvider client={client}>
      <RouterProvider router={router} />
    </ApolloProvider>
  </StrictMode>,
);
