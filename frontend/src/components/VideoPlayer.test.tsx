import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VideoPlayer } from './VideoPlayer';

// jsdom har ingen mediaavspilling. Denne attrappen etterligner nettleseren godt nok til å teste
// kontrollene: egenskapene leses fra `media`, og play/pause sender de samme hendelsene som ekte.
const media = {
  paused: true,
  ended: false,
  currentTime: 0,
  duration: 100,
  volume: 1,
  muted: false,
  bufferedEnd: 0,
  tracks: [] as { mode: string }[],
};

const emit = (el: Element, type: string) => el.dispatchEvent(new Event(type));
const proto = HTMLMediaElement.prototype;
const requestFullscreen = vi.fn(() => Promise.resolve());
const exitFullscreen = vi.fn(() => Promise.resolve());

function defineMedia() {
  const get = (key: keyof typeof media) => ({ configurable: true, get: () => media[key] });
  Object.defineProperties(proto, {
    paused: get('paused'),
    ended: get('ended'),
    duration: get('duration'),
    textTracks: { configurable: true, get: () => media.tracks },
    buffered: {
      configurable: true,
      get: () => ({ length: 1, start: () => 0, end: () => media.bufferedEnd }),
    },
    currentTime: {
      configurable: true,
      get: () => media.currentTime,
      set(v: number) {
        media.currentTime = v;
      },
    },
    volume: {
      configurable: true,
      get: () => media.volume,
      set(this: HTMLMediaElement, v: number) {
        media.volume = v;
        emit(this, 'volumechange');
      },
    },
    muted: {
      configurable: true,
      get: () => media.muted,
      set(this: HTMLMediaElement, v: boolean) {
        media.muted = v;
        emit(this, 'volumechange');
      },
    },
  });
  proto.play = vi.fn(function (this: HTMLMediaElement) {
    media.paused = false;
    emit(this, 'play');
    return Promise.resolve();
  });
  proto.pause = vi.fn(function (this: HTMLMediaElement) {
    media.paused = true;
    emit(this, 'pause');
  });
}

beforeEach(() => {
  Object.assign(media, {
    paused: true,
    ended: false,
    currentTime: 0,
    duration: 100,
    volume: 1,
    muted: false,
    bufferedEnd: 0,
    tracks: [],
  });
  localStorage.clear();
  defineMedia();
  Element.prototype.requestFullscreen = requestFullscreen;
  document.exitFullscreen = exitFullscreen;
  requestFullscreen.mockClear();
  exitFullscreen.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
});

interface Options {
  subtitlesUrl?: string | null;
  durationHint?: number | null;
}

function setup(options: Options = {}) {
  const utils = render(
    <VideoPlayer
      src="https://archive.example/film.mp4"
      title="Nosferatu"
      archiveUrl="https://archive.org/details/film"
      {...options}
    />,
  );
  const video = () => document.querySelector('video')!;
  const group = screen.getByRole('group', { name: 'Videospiller: Nosferatu' });
  // Nettleseren har lest metadata: da kjenner spilleren varigheten.
  const loaded = (duration = 100) => {
    media.duration = duration;
    act(() => void emit(video(), 'loadedmetadata'));
  };
  const key = (k: string, init: KeyboardEventInit = {}, target: Element = group) =>
    fireEvent.keyDown(target, { key: k, ...init });
  const status = () => screen.getByRole('status').textContent;
  return { ...utils, video, group, loaded, key, status };
}

const timeline = () => screen.getByRole('slider', { name: 'Tidslinje' }) as HTMLInputElement;
const volume = () => screen.getByRole('slider', { name: 'Volum' }) as HTMLInputElement;

describe('VideoPlayer: grunnoppsett', () => {
  it('bruker native video med metadata-preload, playsInline og ingen innebygde kontroller', () => {
    const { video } = setup();
    expect(video()).toHaveAttribute('preload', 'metadata');
    expect(video()).toHaveAttribute('playsinline');
    expect(video()).not.toHaveAttribute('controls');
    expect(video()).toHaveAttribute('src', 'https://archive.example/film.mp4');
  });

  it('gir alle knapper og sliders tilgjengelige navn', () => {
    setup({ subtitlesUrl: 'https://archive.example/film.vtt' });
    for (const control of [...screen.getAllByRole('button'), ...screen.getAllByRole('slider')]) {
      expect(control).toHaveAccessibleName();
    }
  });

  it('viser lasting til metadata er lest, og igjen ved buffering', () => {
    const { loaded, video } = setup();
    expect(screen.getByText('Laster …')).toBeInTheDocument();
    loaded();
    expect(screen.queryByText('Laster …')).not.toBeInTheDocument();
    act(() => void emit(video(), 'waiting'));
    expect(screen.getByText('Laster …')).toBeInTheDocument();
    act(() => void emit(video(), 'playing'));
    expect(screen.queryByText('Laster …')).not.toBeInTheDocument();
  });
});

describe('VideoPlayer: spill av og pause', () => {
  it('knappen bytter navn og statusen annonseres', () => {
    const { loaded, status } = setup();
    loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Spill av' }));
    expect(proto.play).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    expect(status()).toBe('Spiller');
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(proto.pause).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Spill av' })).toBeInTheDocument();
    expect(status()).toBe('Pause');
  });

  it('klikk på videoen veksler mellom spill og pause', () => {
    const { loaded, video } = setup();
    loaded();
    fireEvent.click(video());
    expect(proto.play).toHaveBeenCalledTimes(1);
    fireEvent.click(video());
    expect(proto.pause).toHaveBeenCalledTimes(1);
  });

  it('tåler at play() avvises (f.eks. blokkert av nettleseren)', async () => {
    const { loaded } = setup();
    loaded();
    proto.play = vi.fn(() => Promise.reject(new DOMException('blocked', 'NotAllowedError')));
    fireEvent.click(screen.getByRole('button', { name: 'Spill av' }));
    await act(async () => undefined);
    expect(screen.getByRole('button', { name: 'Spill av' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('annonserer «Ferdig» når filmen er slutt', () => {
    const { loaded, video, status } = setup();
    loaded();
    act(() => void emit(video(), 'ended'));
    expect(status()).toBe('Ferdig');
  });
});

describe('VideoPlayer: tidslinje og spoling', () => {
  it('har navn, verdi-tekst med «av» og oppdaterer seg mens filmen spiller', () => {
    const { loaded, video } = setup();
    loaded(5530);
    expect(timeline()).toHaveAttribute('aria-valuetext', '0:00 av 1:32:10');
    expect(timeline()).toHaveAttribute('max', '5530');
    media.currentTime = 723.4;
    act(() => void emit(video(), 'timeupdate'));
    expect(timeline()).toHaveAttribute('aria-valuetext', '12:03 av 1:32:10');
    expect(timeline()).toHaveValue('723');
    expect(screen.getByText('12:03 / 1:32:10')).toBeInTheDocument();
  });

  it('spoler ved å dra i tidslinjen', () => {
    const { loaded } = setup();
    loaded(5530);
    fireEvent.change(timeline(), { target: { value: '723' } });
    expect(media.currentTime).toBe(723);
    expect(timeline()).toHaveAttribute('aria-valuetext', '12:03 av 1:32:10');
  });

  it('bruker varighet fra API-et til metadata er lest, og er ellers deaktivert', () => {
    media.duration = NaN;
    const { unmount } = setup({ durationHint: 600 });
    expect(timeline()).toHaveAttribute('max', '600');
    expect(timeline()).toBeEnabled();
    unmount();
    setup();
    expect(timeline()).toBeDisabled();
    expect(timeline()).toHaveAttribute('aria-valuetext', '0:00 av 0:00');
  });

  it('tegner bufret del som CSS-variabel', () => {
    const { loaded, video } = setup();
    loaded(100);
    media.bufferedEnd = 40;
    act(() => void emit(video(), 'progress'));
    expect(timeline().style.getPropertyValue('--buffered')).toBe('40%');
  });

  it('knappene spoler 10 sekunder og stopper ved start og slutt', () => {
    const { loaded, status } = setup();
    loaded(100);
    media.currentTime = 50;
    fireEvent.click(screen.getByRole('button', { name: '+10 s, spol frem' }));
    expect(media.currentTime).toBe(60);
    expect(status()).toBe('10 sekunder frem');
    fireEvent.click(screen.getByRole('button', { name: '−10 s, spol tilbake' }));
    expect(media.currentTime).toBe(50);

    media.currentTime = 4;
    fireEvent.click(screen.getByRole('button', { name: '−10 s, spol tilbake' }));
    expect(media.currentTime).toBe(0);
    media.currentTime = 95;
    fireEvent.click(screen.getByRole('button', { name: '+10 s, spol frem' }));
    expect(media.currentTime).toBe(100);
  });
});

describe('VideoPlayer: volum og demping', () => {
  it('volumsliderens verdi setter volumet og huskes i localStorage', () => {
    setup();
    fireEvent.change(volume(), { target: { value: '40' } });
    expect(media.volume).toBe(0.4);
    expect(volume()).toHaveAttribute('aria-valuetext', '40 %');
    expect(JSON.parse(localStorage.getItem('filmsok:player')!)).toEqual({
      volume: 0.4,
      muted: false,
    });
  });

  it('bruker lagret volum og demping når spilleren åpnes', () => {
    localStorage.setItem('filmsok:player', JSON.stringify({ volume: 0.3, muted: true }));
    setup();
    expect(media.volume).toBe(0.3);
    expect(media.muted).toBe(true);
    expect(screen.getByRole('button', { name: 'Slå på lyd' })).toBeInTheDocument();
    expect(volume()).toHaveValue('0');
  });

  it('ignorerer ødelagt lagret verdi', () => {
    localStorage.setItem('filmsok:player', '{ikke json');
    const { unmount } = setup();
    expect(media.volume).toBe(1);
    unmount();
    localStorage.setItem('filmsok:player', JSON.stringify({ volume: 'høyt', muted: 'ja' }));
    setup();
    expect(media.volume).toBe(1);
    expect(media.muted).toBe(false);
  });

  it('demp-knappen bytter navn og annonserer «Lyd av» / «Lyd på»', () => {
    const { status } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Slå av lyd' }));
    expect(media.muted).toBe(true);
    expect(status()).toBe('Lyd av');
    fireEvent.click(screen.getByRole('button', { name: 'Slå på lyd' }));
    expect(media.muted).toBe(false);
    expect(status()).toBe('Lyd på');
  });

  it('å dra volumet opp fra demping slår på lyden', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Slå av lyd' }));
    fireEvent.change(volume(), { target: { value: '60' } });
    expect(media.muted).toBe(false);
    expect(media.volume).toBe(0.6);
  });
});

describe('VideoPlayer: tastatur', () => {
  it('mellomrom og K spiller av og pauser', () => {
    const { key, loaded } = setup();
    loaded();
    key(' ');
    expect(proto.play).toHaveBeenCalledTimes(1);
    key('k');
    expect(proto.pause).toHaveBeenCalledTimes(1);
    key('K');
    expect(proto.play).toHaveBeenCalledTimes(2);
  });

  it('hindrer at mellomrom ruller siden', () => {
    const { group, loaded } = setup();
    loaded();
    const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    group.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('piltastene spoler ±10 s', () => {
    const { key, loaded } = setup();
    loaded(100);
    media.currentTime = 30;
    key('ArrowRight');
    expect(media.currentTime).toBe(40);
    key('ArrowLeft');
    key('ArrowLeft');
    expect(media.currentTime).toBe(20);
  });

  it('opp/ned endrer volumet med 10 % og annonserer det', () => {
    localStorage.setItem('filmsok:player', JSON.stringify({ volume: 0.5, muted: false }));
    const { key, status } = setup();
    key('ArrowUp');
    expect(media.volume).toBe(0.6);
    expect(status()).toBe('Volum 60 %');
    key('ArrowDown');
    key('ArrowDown');
    expect(media.volume).toBe(0.4);
    for (let i = 0; i < 8; i++) key('ArrowDown');
    expect(media.volume).toBe(0);
    for (let i = 0; i < 12; i++) key('ArrowUp');
    expect(media.volume).toBe(1);
  });

  it('M demper og F går til fullskjerm', () => {
    const { key } = setup();
    key('m');
    expect(media.muted).toBe(true);
    key('M');
    expect(media.muted).toBe(false);
    key('f');
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
  });

  it('lar knapper og sliders beholde tastene de eier', () => {
    const { key, loaded } = setup();
    loaded(100);
    media.currentTime = 30;
    // Mellomrom på en knapp klikker knappen (nettleseren), spilleren skal ikke også toggle.
    key(' ', {}, screen.getByRole('button', { name: 'Spill av' }));
    expect(proto.play).not.toHaveBeenCalled();
    // Piltaster på sliderne flytter sliderne, ikke filmen/volumet globalt.
    key('ArrowRight', {}, timeline());
    key('ArrowUp', {}, volume());
    expect(media.currentTime).toBe(30);
    expect(media.volume).toBe(1);
    // Mellomrom på en slider har ingen egen betydning, så det spiller av.
    key(' ', {}, timeline());
    expect(proto.play).toHaveBeenCalledTimes(1);
  });

  it('ignorerer snarveier med Ctrl/Alt/Meta (nettleserens egne)', () => {
    const { key, loaded } = setup();
    loaded();
    key('k', { ctrlKey: true });
    key('m', { metaKey: true });
    key('f', { altKey: true });
    expect(proto.play).not.toHaveBeenCalled();
    expect(media.muted).toBe(false);
    expect(requestFullscreen).not.toHaveBeenCalled();
  });

  it('kaprer ikke taster i felt utenfor spilleren', () => {
    setup();
    render(<input aria-label="Annet felt" />);
    const input = screen.getByLabelText('Annet felt');
    fireEvent.keyDown(input, { key: 'm' });
    fireEvent.keyDown(input, { key: ' ' });
    expect(media.muted).toBe(false);
    expect(proto.play).not.toHaveBeenCalled();
  });
});

describe('VideoPlayer: fullskjerm', () => {
  it('knappen ber wrapperen om fullskjerm og avslutter når den allerede er der', () => {
    const { group } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Fullskjerm' }));
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(requestFullscreen.mock.contexts[0]).toBe(group);

    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: group });
    act(() => void document.dispatchEvent(new Event('fullscreenchange')));
    expect(group).toHaveClass('is-fullscreen');
    fireEvent.click(screen.getByRole('button', { name: 'Avslutt fullskjerm' }));
    expect(exitFullscreen).toHaveBeenCalledTimes(1);
  });

  it('tåler at nettleseren avslår fullskjerm', async () => {
    requestFullscreen.mockImplementationOnce(() => Promise.reject(new TypeError('nei')));
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Fullskjerm' }));
    await act(async () => undefined);
    expect(screen.getByRole('button', { name: 'Fullskjerm' })).toBeInTheDocument();
  });

  it('skjuler knappen og F når fullskjerm ikke støttes', () => {
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: false });
    const { key } = setup();
    expect(screen.queryByRole('button', { name: /fullskjerm/i })).not.toBeInTheDocument();
    key('f');
    expect(requestFullscreen).not.toHaveBeenCalled();
  });
});

describe('VideoPlayer: undertekster', () => {
  const subs = 'https://archive.example/film.vtt';

  it('legger til track og CC-knapp når underteksten finnes', () => {
    const { video } = setup({ subtitlesUrl: subs });
    const track = video().querySelector('track')!;
    expect(track).toHaveAttribute('kind', 'subtitles');
    expect(track).toHaveAttribute('srclang', 'en');
    expect(track).toHaveAttribute('src', subs);
    expect(track).toHaveAttribute('default');
    // Undertekster fra en annen opprinnelse krever CORS.
    expect(video()).toHaveAttribute('crossorigin', 'anonymous');
    expect(screen.getByRole('button', { name: 'Undertekster' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('CC-knappen og C skrur undertekstsporet av og på', () => {
    const track = { mode: 'showing' };
    media.tracks = [track];
    const { loaded, key, status } = setup({ subtitlesUrl: subs });
    loaded();
    const cc = screen.getByRole('button', { name: 'Undertekster' });
    fireEvent.click(cc);
    expect(cc).toHaveAttribute('aria-pressed', 'false');
    expect(track.mode).toBe('hidden');
    expect(status()).toBe('Undertekster av');
    key('c');
    expect(cc).toHaveAttribute('aria-pressed', 'true');
    expect(track.mode).toBe('showing');
    expect(status()).toBe('Undertekster på');
  });

  it('har ingen track, CC-knapp eller CORS-krav uten underteksturl', () => {
    const { video, key } = setup({ subtitlesUrl: null });
    expect(video().querySelector('track')).toBeNull();
    expect(video()).not.toHaveAttribute('crossorigin');
    expect(screen.queryByRole('button', { name: 'Undertekster' })).not.toBeInTheDocument();
    key('c');
  });

  it('prøver uten undertekster hvis videoen feiler med CORS-kravet, og feiler først etter det', () => {
    const { video } = setup({ subtitlesUrl: subs });
    fireEvent.error(video());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(video().querySelector('track')).toBeNull();
    expect(video()).not.toHaveAttribute('crossorigin');
    fireEvent.error(video());
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});

describe('VideoPlayer: feil', () => {
  it('viser melding, lenke til archive.org og skjuler kontrollene', () => {
    const { video } = setup();
    fireEvent.error(video());
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Kunne ikke spille av videoen');
    expect(screen.getByRole('link', { name: /archive\.org/ })).toHaveAttribute(
      'href',
      'https://archive.org/details/film',
    );
    expect(screen.queryByRole('slider', { name: 'Tidslinje' })).not.toBeInTheDocument();
    expect(screen.queryByText('Laster …')).not.toBeInTheDocument();
  });

  it('«Prøv igjen» laster et nytt video-element', () => {
    const { video } = setup();
    const first = video();
    fireEvent.error(first);
    fireEvent.click(screen.getByRole('button', { name: 'Prøv igjen' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(video()).not.toBe(first);
    expect(screen.getByRole('slider', { name: 'Tidslinje' })).toBeInTheDocument();
  });
});

describe('VideoPlayer: fokus ved feil', () => {
  it('flytter fokus til «Prøv igjen» når en feil fjerner kontrollene fokus lå på', () => {
    const { video } = setup();
    screen.getByRole('button', { name: 'Spill av' }).focus();
    fireEvent.error(video());
    expect(screen.getByRole('button', { name: 'Prøv igjen' })).toHaveFocus();
  });

  it('flytter fokus til spill-knappen etter nytt forsøk', () => {
    const { video } = setup();
    screen.getByRole('button', { name: 'Spill av' }).focus();
    fireEvent.error(video());
    fireEvent.click(screen.getByRole('button', { name: 'Prøv igjen' }));
    expect(screen.getByRole('button', { name: 'Spill av' })).toHaveFocus();
  });

  it('stjeler ikke fokus når feilen kommer mens brukeren er et annet sted', () => {
    const { video } = setup();
    const other = document.createElement('input');
    document.body.append(other);
    other.focus();
    fireEvent.error(video());
    expect(screen.getByRole('button', { name: 'Prøv igjen' })).not.toHaveFocus();
    expect(other).toHaveFocus();
    other.remove();
  });
});

describe('VideoPlayer: skjulte kontroller', () => {
  it('skjules etter 3 s uten bevegelse mens den spiller, og vises igjen ved bevegelse', () => {
    vi.useFakeTimers();
    const { group, loaded } = setup();
    loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Spill av' }));
    expect(group).not.toHaveClass('is-idle');
    act(() => void vi.advanceTimersByTime(2900));
    expect(group).not.toHaveClass('is-idle');
    act(() => void vi.advanceTimersByTime(200));
    expect(group).toHaveClass('is-idle');
    fireEvent.pointerMove(group);
    expect(group).not.toHaveClass('is-idle');
    act(() => void vi.advanceTimersByTime(3100));
    expect(group).toHaveClass('is-idle');
  });

  it('skjules aldri mens den står på pause', () => {
    vi.useFakeTimers();
    const { group, loaded } = setup();
    loaded();
    fireEvent.pointerMove(group);
    act(() => void vi.advanceTimersByTime(10_000));
    expect(group).not.toHaveClass('is-idle');
  });

  it('vises igjen når den pauses, og tastetrykk viser kontrollene', () => {
    vi.useFakeTimers();
    const { group, loaded, key } = setup();
    loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Spill av' }));
    act(() => void vi.advanceTimersByTime(3100));
    expect(group).toHaveClass('is-idle');
    key('ArrowRight');
    expect(group).not.toHaveClass('is-idle');
    act(() => void vi.advanceTimersByTime(3100));
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(group).not.toHaveClass('is-idle');
  });
});
