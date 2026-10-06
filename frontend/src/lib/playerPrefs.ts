const KEY = 'filmsok:player';

interface PlayerPrefs {
  volume: number;
  muted: boolean;
}

const DEFAULTS: PlayerPrefs = { volume: 1, muted: false };

/** localStorage kan kaste (blokkert av nettleseren) eller inneholde rusk; da bruker vi standardverdier. */
export function loadPlayerPrefs(): PlayerPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<PlayerPrefs> | null;
    const volume = Number(raw?.volume);
    return {
      volume: Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : DEFAULTS.volume,
      muted: raw?.muted === true,
    };
  } catch {
    return DEFAULTS;
  }
}

export function savePlayerPrefs(prefs: PlayerPrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Å huske volum er en bekvemmelighet; feil her skal aldri stoppe avspillingen.
  }
}
