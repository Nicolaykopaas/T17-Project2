import { Link } from 'react-router';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

export default function NotFoundPage({ what = 'siden' }: { what?: string }) {
  useDocumentTitle('Fant ikke siden');
  return (
    <>
      <h1>Fant ikke {what}</h1>
      <p>Adressen finnes ikke, eller innholdet er fjernet.</p>
      <p>
        <Link to="/">Tilbake til søket</Link>
      </p>
    </>
  );
}
