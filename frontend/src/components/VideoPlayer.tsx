import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { formatClock } from '../lib/format';
import { loadPlayerPrefs, savePlayerPrefs } from '../lib/playerPrefs';

interface Props {
  src: string;
  title: string;
  archiveUrl: string;
  subtitlesUrl?: string | null;
  poster?: string | null;
  /** Varighet fra API-et. Brukes til nettleseren har lest metadata, så tidslinjen ikke hopper. */
  durationHint?: number | null;
}

const SKIP_SECONDS = 10;
const VOLUME_STEP = 0.1;
// Lenge nok til at musepekeren kan hvile uten at kontrollene flimrer, kort nok til å ikke skjule bildet.
const IDLE_MS = 3000;
const TOAST_MS = 1500;

interface WebkitVideo extends HTMLVideoElement {
  webkitEnterFullscreen?: () => void;
}

const noop = () => undefined;

/** Enkle inline-SVG-er: ingen ikonbibliotek å laste, og de arver `currentColor` i begge temaer. */
function Icon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
      <path d={path} fill="currentColor" />
    </svg>
  );
}

const PATHS = {
  play: 'M8 5v14l11-7z',
  pause: 'M6 5h4v14H6zM14 5h4v14h-4z',
  volume:
    'M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z',
  muted: 'M3 9v6h4l5 5V4L7 9H3z',
  mutedX: 'M16 9l5 6m0-6l-5 6',
  enter: 'M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z',
  exit: 'M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z',
};

/**
 * Egen spiller på native `<video>`: ingen spillerbibliotek å laste, og full kontroll over
 * tilgjengelighet. Nettleserens innebygde kontroller er skrudd av fordi de varierer mye i
 * tastaturstøtte og ikke kan få norske navn.
 */
export function VideoPlayer({ src, title, archiveUrl, subtitlesUrl, poster, durationHint }: Props) {
  const wrapper = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const playButton = useRef<HTMLButtonElement>(null);
  const retryButton = useRef<HTMLButtonElement>(null);
  // Ved feil og nytt forsøk byttes kontrollene mot feilmeldingen og tilbake; knappen som hadde fokus forsvinner
  // begge veier. Hvor fokus skal lande etter neste render (kontrollene finnes ikke før den er committet).
  const focusAfter = useRef<'retry' | 'play' | null>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [prefs] = useState(loadPlayerPrefs);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [time, setTime] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolumeState] = useState(prefs.volume);
  const [muted, setMuted] = useState(prefs.muted);
  const [fullscreen, setFullscreen] = useState(false);
  const [captions, setCaptions] = useState(true);
  const [idle, setIdle] = useState(false);
  const [failed, setFailed] = useState(false);
  const [status, setStatus] = useState('');
  // Undertekster krever CORS på videoen. Godtar ikke serveren det, spiller vi heller uten
  // undertekster enn å miste hele filmen.
  const [subsOk, setSubsOk] = useState(true);
  const [attempt, setAttempt] = useState(0);

  const showSubs = !!subtitlesUrl && subsOk;
  const duration = mediaDuration > 0 ? mediaDuration : (durationHint ?? 0);
  const hasFullscreen =
    typeof document === 'undefined' ||
    document.fullscreenEnabled !== false ||
    'webkitEnterFullscreen' in HTMLVideoElement.prototype;

  const announce = useCallback((message: string) => {
    setStatus(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setStatus(''), TOAST_MS);
  }, []);

  /** Viser kontrollene og starter nedtellingen til de skjules igjen (bare mens den spiller). */
  const wake = useCallback(() => {
    setIdle(false);
    clearTimeout(idleTimer.current);
    if (video.current && !video.current.paused) {
      idleTimer.current = setTimeout(() => setIdle(true), IDLE_MS);
    }
  }, []);

  useEffect(
    () => () => {
      clearTimeout(idleTimer.current);
      clearTimeout(toastTimer.current);
    },
    [],
  );

  // Lagret volum brukes på hvert nytt video-element (også etter «Prøv igjen»).
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    el.volume = prefs.volume;
    el.muted = prefs.muted;
  }, [prefs, attempt, subsOk]);

  useEffect(() => {
    const target = focusAfter.current;
    if (target === 'retry' && failed) retryButton.current?.focus();
    else if (target === 'play' && !failed) playButton.current?.focus();
    else return;
    focusAfter.current = null;
  }, [failed]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === wrapper.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  useEffect(() => {
    const track = video.current?.textTracks?.[0];
    // TextTrack.mode er DOM-tilstand, ikke React-tilstand; det finnes ingen prop for den.
    // eslint-disable-next-line react-hooks/immutability
    if (track) track.mode = captions ? 'showing' : 'hidden';
  }, [captions, ready, showSubs]);

  const syncTime = (el: HTMLVideoElement) => {
    setTime(el.currentTime || 0);
    if (Number.isFinite(el.duration)) setMediaDuration(el.duration);
    // Bufret del rundt avspillingsposisjonen; det er den som forteller om spoling vil gå raskt.
    const ranges = el.buffered;
    let end = 0;
    for (let i = 0; ranges && i < ranges.length; i++) {
      if (ranges.start(i) <= el.currentTime + 0.5 && ranges.end(i) >= end) end = ranges.end(i);
    }
    setBuffered(end);
  };

  const syncVolume = (el: HTMLVideoElement) => {
    setVolumeState(el.volume);
    setMuted(el.muted);
    savePlayerPrefs({ volume: el.volume, muted: el.muted });
  };

  const toggle = () => {
    const el = video.current;
    if (!el) return;
    if (el.paused || el.ended) void Promise.resolve(el.play()).catch(noop);
    else el.pause();
  };

  const seekTo = (seconds: number) => {
    const el = video.current;
    if (!el) return;
    const max = duration > 0 ? duration : Number.POSITIVE_INFINITY;
    const next = Math.min(max, Math.max(0, seconds));
    el.currentTime = next;
    setTime(next);
  };

  const skip = (delta: number) => {
    const el = video.current;
    if (!el) return;
    seekTo(el.currentTime + delta);
    announce(delta > 0 ? `${delta} sekunder frem` : `${-delta} sekunder tilbake`);
  };

  const changeVolume = (next: number, say = false) => {
    const el = video.current;
    if (!el) return;
    const v = Math.min(1, Math.max(0, Math.round(next * 100) / 100));
    el.volume = v;
    if (v > 0 && el.muted) el.muted = false;
    syncVolume(el);
    if (say) announce(`Volum ${Math.round(v * 100)} %`);
  };

  const toggleMute = () => {
    const el = video.current;
    if (!el) return;
    el.muted = !el.muted;
    // Å slå på lyd når volumet står på 0 gir ingen lyd og ser ut som en feil.
    if (!el.muted && el.volume === 0) el.volume = 0.5;
    syncVolume(el);
    announce(el.muted ? 'Lyd av' : 'Lyd på');
  };

  const toggleFullscreen = () => {
    const el = wrapper.current;
    if (!el) return;
    if (document.fullscreenElement) {
      void Promise.resolve(document.exitFullscreen?.()).catch(noop);
    } else if (el.requestFullscreen && document.fullscreenEnabled !== false) {
      void Promise.resolve(el.requestFullscreen()).catch(noop);
    } else {
      // iPhone støtter bare fullskjerm på selve video-elementet.
      (video.current as WebkitVideo | null)?.webkitEnterFullscreen?.();
    }
  };

  const toggleCaptions = () => {
    setCaptions((on) => !on);
    announce(captions ? 'Undertekster av' : 'Undertekster på');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    wake();
    if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
    const target = e.target as HTMLElement;
    // Tekstfelt eier tastene sine; sliderne eier bare piltastene (de flytter seg selv).
    if (target.closest('input:not([type="range"]), textarea, select, [contenteditable="true"]'))
      return;
    const onRange = target instanceof HTMLInputElement && target.type === 'range';
    // Mellomrom på en knapp eller lenke skal utløse den, ikke også spille av/pause.
    const onActivatable = target.closest('button, a') !== null;

    const handled = (fn: () => void) => {
      e.preventDefault();
      fn();
    };
    switch (e.key) {
      case ' ':
        if (!onActivatable) handled(toggle);
        break;
      case 'k':
      case 'K':
        handled(toggle);
        break;
      case 'ArrowLeft':
      case 'ArrowRight':
        if (!onRange) handled(() => skip(e.key === 'ArrowRight' ? SKIP_SECONDS : -SKIP_SECONDS));
        break;
      case 'ArrowUp':
      case 'ArrowDown':
        if (!onRange) {
          handled(() =>
            changeVolume(
              (video.current?.volume ?? volume) +
                (e.key === 'ArrowUp' ? VOLUME_STEP : -VOLUME_STEP),
              true,
            ),
          );
        }
        break;
      case 'm':
      case 'M':
        handled(toggleMute);
        break;
      case 'f':
      case 'F':
        if (hasFullscreen) handled(toggleFullscreen);
        break;
      case 'c':
      case 'C':
        if (showSubs) handled(toggleCaptions);
        break;
    }
  };

  const onError = () => {
    if (showSubs) {
      // Første feil med undertekster: prøv på nytt uten CORS-kravet.
      setSubsOk(false);
    } else {
      // Bare når fokus var i spilleren: en feil som kommer mens brukeren er et annet sted skal ikke stjele det.
      if (wrapper.current?.contains(document.activeElement)) focusAfter.current = 'retry';
      setFailed(true);
      setPlaying(false);
      setWaiting(false);
    }
  };

  const retry = () => {
    focusAfter.current = 'play';
    setFailed(false);
    setReady(false);
    setWaiting(false);
    setPlaying(false);
    setSubsOk(!!subtitlesUrl);
    setAttempt((n) => n + 1);
  };

  const loading = !failed && (!ready || waiting);
  const volumePct = Math.round((muted ? 0 : volume) * 100);
  const progressPct = duration > 0 ? Math.min(100, (time / duration) * 100) : 0;
  const bufferedPct = duration > 0 ? Math.min(100, (buffered / duration) * 100) : 0;
  const classes = [
    'player',
    idle && playing ? 'is-idle' : '',
    fullscreen ? 'is-fullscreen' : '',
    failed ? 'is-failed' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    // Tastene gjelder mens fokus er inne i spilleren. Wrapperen kan få fokus ved klikk på bildet
    // (tabIndex -1), men er ikke et eget tabb-stopp; knappene er det.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      ref={wrapper}
      className={classes}
      role="group"
      aria-label={`Videospiller: ${title}`}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onPointerMove={wake}
      onPointerDown={wake}
    >
      {/* Undertekster finnes bare når Internet Archive har en .vtt-fil; kontrollene under er tastatur-alternativet til klikk. */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video
        key={`${attempt}-${subsOk}`}
        ref={video}
        className="player__video"
        src={src}
        poster={poster ?? undefined}
        preload="metadata"
        playsInline
        crossOrigin={showSubs ? 'anonymous' : undefined}
        onClick={toggle}
        onDoubleClick={toggleFullscreen}
        onLoadedMetadata={(e) => {
          setReady(true);
          syncTime(e.currentTarget);
        }}
        onDurationChange={(e) => syncTime(e.currentTarget)}
        onTimeUpdate={(e) => syncTime(e.currentTarget)}
        onProgress={(e) => syncTime(e.currentTarget)}
        onPlay={() => {
          setPlaying(true);
          announce('Spiller');
          wake();
        }}
        onPlaying={() => setWaiting(false)}
        onPause={() => {
          setPlaying(false);
          setIdle(false);
          clearTimeout(idleTimer.current);
          announce('Pause');
        }}
        onWaiting={() => setWaiting(true)}
        onCanPlay={() => {
          setReady(true);
          setWaiting(false);
        }}
        onSeeked={() => setWaiting(false)}
        onVolumeChange={(e) => syncVolume(e.currentTarget)}
        onEnded={() => {
          setPlaying(false);
          setIdle(false);
          announce('Ferdig');
        }}
        onError={onError}
      >
        {showSubs && (
          <track kind="subtitles" srcLang="en" label="English" src={subtitlesUrl!} default />
        )}
      </video>

      {loading && (
        <div className="player__loading" aria-hidden="true">
          <span className="player__spinner" />
          <span>Laster …</span>
        </div>
      )}
      {!playing && !loading && !failed && (
        <div className="player__bigplay" aria-hidden="true">
          <Icon path={PATHS.play} />
        </div>
      )}
      {status && (
        <div className="player__toast" aria-hidden="true">
          {status}
        </div>
      )}

      {failed ? (
        <div className="player__error" role="alert">
          <p>
            <strong>Kunne ikke spille av videoen</strong>
          </p>
          <p>
            Sjekk nettverket og prøv igjen, eller{' '}
            <a href={archiveUrl} target="_blank" rel="noopener noreferrer">
              se filmen på archive.org<span className="sr-only"> (åpnes i ny fane)</span>
            </a>
            .
          </p>
          <button ref={retryButton} type="button" className="btn" onClick={retry}>
            Prøv igjen
          </button>
        </div>
      ) : (
        <div className="player__controls">
          <input
            type="range"
            className="player__timeline"
            aria-label="Tidslinje"
            aria-valuetext={`${formatClock(time)} av ${formatClock(duration)}`}
            min={0}
            max={duration || 0}
            step={1}
            value={Math.min(Math.floor(time), duration || 0)}
            disabled={!duration}
            style={
              {
                '--progress': `${progressPct}%`,
                '--buffered': `${Math.max(bufferedPct, progressPct)}%`,
              } as CSSProperties
            }
            onChange={(e) => seekTo(Number(e.target.value))}
          />
          <div className="player__row">
            <button
              ref={playButton}
              type="button"
              className="player__btn"
              aria-label={playing ? 'Pause' : 'Spill av'}
              onClick={toggle}
            >
              <Icon path={playing ? PATHS.pause : PATHS.play} />
            </button>
            <button
              type="button"
              className="player__btn player__btn--text"
              aria-label="Spol 10 sekunder tilbake"
              onClick={() => skip(-SKIP_SECONDS)}
            >
              <span aria-hidden="true">−10 s</span>
            </button>
            <button
              type="button"
              className="player__btn player__btn--text"
              aria-label="Spol 10 sekunder frem"
              onClick={() => skip(SKIP_SECONDS)}
            >
              <span aria-hidden="true">+10 s</span>
            </button>
            <span className="player__time" aria-hidden="true">
              {formatClock(time)} / {formatClock(duration)}
            </span>

            <span className="player__spacer" />

            <button
              type="button"
              className="player__btn"
              aria-label={muted || volume === 0 ? 'Slå på lyd' : 'Slå av lyd'}
              onClick={toggleMute}
            >
              <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
                <path d={muted || volume === 0 ? PATHS.muted : PATHS.volume} fill="currentColor" />
                {(muted || volume === 0) && (
                  <path
                    d={PATHS.mutedX}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                )}
              </svg>
            </button>
            <input
              type="range"
              className="player__volume"
              aria-label="Volum"
              aria-valuetext={`${volumePct} %`}
              min={0}
              max={100}
              step={5}
              value={volumePct}
              style={{ '--v': `${volumePct}%` } as CSSProperties}
              onChange={(e) => changeVolume(Number(e.target.value) / 100)}
            />
            {showSubs && (
              <button
                type="button"
                className="player__btn player__btn--text"
                aria-label="Undertekster"
                aria-pressed={captions}
                onClick={toggleCaptions}
              >
                <span aria-hidden="true">CC</span>
              </button>
            )}
            {hasFullscreen && (
              <button
                type="button"
                className="player__btn"
                aria-label={fullscreen ? 'Avslutt fullskjerm' : 'Fullskjerm'}
                onClick={toggleFullscreen}
              >
                <Icon path={fullscreen ? PATHS.exit : PATHS.enter} />
              </button>
            )}
          </div>
        </div>
      )}

      <p className="sr-only" role="status" aria-live="polite">
        {status}
      </p>
    </div>
  );
}
