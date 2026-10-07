import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { HeaderSearch } from '../components/HeaderSearch';
import { currentUrl, renderApp } from '../test/utils';

describe('useSearchState: historikk', () => {
  it('første søk fra forsiden legger en ny oppføring, så «tilbake» går til forsiden', async () => {
    const user = userEvent.setup();
    const { router } = renderApp(<HeaderSearch />, { route: '/' });
    const input = screen.getByLabelText('Søk etter tittel');

    await user.type(input, 'alien');
    await waitFor(() => expect(currentUrl().search).toBe('?q=alien'), { timeout: 2000 });

    await act(() => router.navigate(-1));
    expect(currentUrl().pathname + currentUrl().search).toBe('/');
  });

  it('videre endringer i søkemodus erstatter oppføringen i stedet for å fylle historikken', async () => {
    const user = userEvent.setup();
    const { router } = renderApp(<HeaderSearch />, { route: '/' });
    const input = screen.getByLabelText('Søk etter tittel');

    await user.type(input, 'alien');
    await waitFor(() => expect(currentUrl().search).toBe('?q=alien'), { timeout: 2000 });
    await user.type(input, 's');
    await waitFor(() => expect(currentUrl().search).toBe('?q=aliens'), { timeout: 2000 });

    // Ett skritt tilbake gir forsiden, ikke «?q=alien».
    await act(() => router.navigate(-1));
    expect(currentUrl().pathname + currentUrl().search).toBe('/');
  });

  it('å tømme søket (tilbake til bla-modus) erstatter oppføringen', async () => {
    const user = userEvent.setup();
    const { router } = renderApp(<HeaderSearch />, { route: '/?q=alien' });
    await user.click(screen.getByRole('button', { name: 'Tøm søkefeltet' }));
    await waitFor(() => expect(currentUrl().search).toBe(''));
    // Startet i søkemodus uten historikk bak seg: ingen ny oppføring ble lagt til.
    expect(router.state.historyAction).toBe('REPLACE');
  });
});
