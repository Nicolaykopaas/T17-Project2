import { Link, useParams } from 'react-router';
import { useQuery } from '@apollo/client/react';
import { BackLink } from '../components/BackLink';
import { ErrorMessage } from '../components/ErrorMessage';
import { StreamInfo } from '../components/StreamInfo';
import { VideoPlayer } from '../components/VideoPlayer';
import { WATCH_QUERY } from '../graphql/operations';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { formatClock } from '../lib/format';
import NotFoundPage from './NotFoundPage';

export default function WatchPage() {
  const { id = '' } = useParams();
  const { data, loading, error, refetch } = useQuery(WATCH_QUERY, { variables: { id } });
  const title = data?.title;
  useDocumentTitle(title ? `Se ${title.primaryTitle}` : 'Se film');

  if (data && data.title === null) return <NotFoundPage what="tittelen" />;

  if (error && !title) {
    return (
      <div className="container watch">
        <h1>Se film</h1>
        <ErrorMessage
          message="Kunne ikke hente filmen. Sjekk nettverket og prøv igjen."
          onRetry={() => void refetch().catch(() => undefined)}
        />
      </div>
    );
  }

  if (!title) {
    return (
      <div className="container watch" aria-busy={loading}>
        <h1>Laster …</h1>
      </div>
    );
  }

  const { stream } = title;
  // Fra tittelsiden går «tilbake» i historikken i stedet for å pushe tittelsiden på nytt (ellers ring tittel ↔ spiller).
  const back = (
    <BackLink
      fallbackTo={`/title/${title.id}`}
      fallbackLabel={
        <>
          ← Tilbake<span className="sr-only"> til {title.primaryTitle}</span>
        </>
      }
    />
  );

  if (!stream) {
    return (
      <div className="container watch">
        {back}
        <h1>{title.primaryTitle}</h1>
        <div className="notice">
          <p>Vi har ingen gratisversjon av denne filmen som kan spilles av her.</p>
          <p>
            <Link to={`/title/${title.id}`}>Se detaljer om filmen</Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container watch">
      {back}
      <h1>{title.primaryTitle}</h1>
      <VideoPlayer
        // Ny film = nytt element, ellers henger avspillingsposisjonen igjen fra forrige.
        key={title.id}
        src={stream.url}
        title={title.primaryTitle}
        archiveUrl={stream.archiveUrl}
        subtitlesUrl={stream.subtitlesUrl}
        poster={title.backdrop780}
        durationHint={stream.durationSeconds}
      />
      <section className="watch__info" aria-labelledby="watch-info">
        <h2 id="watch-info">Om visningen</h2>
        <StreamInfo stream={stream} />
        <p className="muted">
          {[
            title.startYear,
            stream.durationSeconds ? formatClock(stream.durationSeconds) : null,
            'Strømmes direkte fra Internet Archive – vi lagrer ingen video selv.',
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        <p>
          <Link to={`/title/${title.id}`}>Mer om {title.primaryTitle}</Link>
        </p>
      </section>
    </div>
  );
}
