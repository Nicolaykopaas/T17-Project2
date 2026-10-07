import { useState } from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchBox } from './SearchBox';

function setup(initial = '') {
  const onCommit = vi.fn();
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
  // Speiler hvordan siden bruker komponenten: verdien kommer fra (URL-)state.
  function Host() {
    const [value, setValue] = useState(initial);
    return (
      <SearchBox
        value={value}
        onCommit={(q) => {
          onCommit(q);
          setValue(q);
        }}
      />
    );
  }
  render(<Host />);
  return { user, onCommit, input: screen.getByLabelText('Søk etter tittel') };
}

describe('SearchBox', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Testing Library oppdager falske timere bare via et globalt `jest`-objekt; uten denne
    // henger user-event fordi RTL venter på en timer som aldri tikker.
    vi.stubGlobal('jest', { advanceTimersByTime: vi.advanceTimersByTime.bind(vi) });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('har en synlig label knyttet til feltet', () => {
    const { input } = setup();
    expect(input).toHaveAccessibleName('Søk etter tittel');
  });

  it('venter 300 ms etter siste tastetrykk før den melder fra', async () => {
    const { user, onCommit, input } = setup();
    await user.type(input, 'matrix');
    expect(onCommit).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(299));
    expect(onCommit).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('matrix');
  });

  it('slår sammen raske tastetrykk til ett kall', async () => {
    const { user, onCommit, input } = setup();
    await user.type(input, 'ab');
    act(() => vi.advanceTimersByTime(200));
    await user.type(input, 'c');
    act(() => vi.advanceTimersByTime(299));
    expect(onCommit).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onCommit).toHaveBeenCalledExactlyOnceWith('abc');
  });

  it('trimmer teksten', async () => {
    const { user, onCommit, input } = setup();
    await user.type(input, '  alien  ');
    act(() => vi.advanceTimersByTime(300));
    expect(onCommit).toHaveBeenCalledExactlyOnceWith('alien');
  });

  it('gjør ingenting når bare mellomrom legges til eller fjernes', async () => {
    const { user, onCommit, input } = setup();
    await user.type(input, 'alien');
    act(() => vi.advanceTimersByTime(300));
    onCommit.mockClear();
    await user.type(input, '   ');
    act(() => vi.advanceTimersByTime(300));
    await user.type(input, '{Backspace}{Backspace}{Backspace}');
    act(() => vi.advanceTimersByTime(300));
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('sender ikke noe for et felt som bare inneholder mellomrom', async () => {
    const { user, onCommit, input } = setup();
    await user.type(input, '     ');
    act(() => vi.advanceTimersByTime(1000));
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('sender ikke på nytt når teksten settes tilbake til det som allerede gjelder', async () => {
    const { user, onCommit, input } = setup();
    await user.type(input, 'heat');
    act(() => vi.advanceTimersByTime(300));
    onCommit.mockClear();
    await user.type(input, 'x{Backspace}');
    act(() => vi.advanceTimersByTime(300));
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('tøm-knappen tømmer feltet, melder fra med en gang og flytter fokus til feltet', async () => {
    const { user, onCommit, input } = setup('alien');
    const clear = screen.getByRole('button', { name: 'Tøm søkefeltet' });
    await user.click(clear);
    expect(input).toHaveValue('');
    expect(input).toHaveFocus();
    expect(onCommit).toHaveBeenCalledExactlyOnceWith('');
    expect(screen.queryByRole('button', { name: 'Tøm søkefeltet' })).not.toBeInTheDocument();
  });

  it('viser ikke tøm-knapp når feltet er tomt', () => {
    setup();
    expect(screen.queryByRole('button', { name: 'Tøm søkefeltet' })).not.toBeInTheDocument();
  });

  it('Enter sender med en gang uten å vente på debounce', async () => {
    const { user, onCommit, input } = setup();
    await user.type(input, 'fargo{Enter}');
    expect(onCommit).toHaveBeenCalledExactlyOnceWith('fargo');
    act(() => vi.advanceTimersByTime(1000));
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('tåler spesialtegn og veldig lange strenger uten å krasje', async () => {
    const { user, onCommit, input } = setup();
    const weird = `<script>"'%_\\ æøå 🎬 ${'x'.repeat(500)}`;
    await user.click(input);
    await user.paste(weird);
    act(() => vi.advanceTimersByTime(300));
    // Feltet kutter ved 200 tegn (backend avviser lengre), så ingenting over grensen sendes videre.
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(weird.slice(0, 200).trim());
  });

  it('har maxLength 200, samme grense som backend', () => {
    const { input } = setup();
    expect(input).toHaveAttribute('maxlength', '200');
  });
});
