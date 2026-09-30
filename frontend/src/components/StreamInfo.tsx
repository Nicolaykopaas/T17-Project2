import type { Stream } from '../graphql/types';

/** Lisens og kilde. Vises der filmen tilbys, slik at rettighetene aldri er skjult for brukeren. */
export function StreamInfo({
  stream,
}: {
  stream: Pick<Stream, 'license' | 'licenseUrl' | 'archiveUrl'>;
}) {
  return (
    <p className="stream-info">
      <span>
        Lisens:{' '}
        {stream.licenseUrl ? (
          <a href={stream.licenseUrl} target="_blank" rel="noopener noreferrer">
            {stream.license}
            <span className="sr-only"> (åpnes i ny fane)</span>
          </a>
        ) : (
          <strong>{stream.license}</strong>
        )}
      </span>
      <span>
        Kilde:{' '}
        <a href={stream.archiveUrl} target="_blank" rel="noopener noreferrer">
          Internet Archive<span className="sr-only"> (åpnes i ny fane)</span>
        </a>
      </span>
    </p>
  );
}
