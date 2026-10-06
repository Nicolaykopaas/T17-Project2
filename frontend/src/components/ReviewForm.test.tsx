import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ADD_REVIEW_MUTATION } from '../graphql/operations';
import { buildMocks, emptyLog, makeReview, renderApp } from '../test/utils';
import { ReviewForm } from './ReviewForm';

function setup({
  delay,
  failFirst = false,
  onSubmitted = vi.fn(),
}: { delay?: number; failFirst?: boolean; onSubmitted?: () => void } = {}) {
  const log = emptyLog();
  const mocks = buildMocks(
    {
      AddReview: (vars) => ({
        addReview: makeReview(1, { ...(vars.input as object), isMine: true }),
      }),
    },
    log,
    failFirst
      ? [
          {
            request: { query: ADD_REVIEW_MUTATION, variables: () => true },
            maxUsageCount: 1,
            error: new Error('Failed to fetch'),
          },
        ]
      : [],
  );
  if (delay) for (const m of mocks) m.delay = delay;
  renderApp(<ReviewForm titleId="tt0000001" onSubmitted={onSubmitted} />, { mocks });
  const user = userEvent.setup();
  return { log, user, onSubmitted };
}

const name = () => screen.getByLabelText('Navn');
const text = () => screen.getByLabelText(/Anmeldelse \(valgfritt\)/);
const stars = (n: number) =>
  screen.getByRole('radio', { name: `${n} ${n === 1 ? 'stjerne' : 'stjerner'}` });
const submit = () => screen.getByRole('button', { name: /Send anmeldelse|Sender/ });

describe('ReviewForm: struktur', () => {
  it('har stjerner som radioknapper i en fieldset med legend', () => {
    setup();
    const group = screen.getByRole('group', { name: 'Vurdering' });
    expect(group.tagName).toBe('FIELDSET');
    expect(screen.getAllByRole('radio')).toHaveLength(5);
  });

  it('viser tegnteller som teller mens man skriver', async () => {
    const { user } = setup();
    expect(screen.getByText('0 / 2000 tegn')).toBeInTheDocument();
    await user.type(text(), 'Hei');
    expect(screen.getByText('3 / 2000 tegn')).toBeInTheDocument();
    expect(text()).toHaveAccessibleDescription(/3 \/ 2000 tegn/);
  });

  it('kan velges med tastaturet (piltaster i radiogruppen)', async () => {
    const { user } = setup();
    await user.click(stars(1));
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(stars(3)).toBeChecked();
  });
});

describe('ReviewForm: validering', () => {
  it('avviser tomt skjema med feil på navn og stjerner, uten å sende', async () => {
    const { user, log } = setup();
    await user.click(submit());
    expect(name()).toHaveAccessibleDescription('Skriv inn navnet ditt.');
    expect(name()).toBeInvalid();
    expect(screen.getByRole('group', { name: 'Vurdering' })).toHaveAccessibleDescription(
      'Velg et antall stjerner fra 1 til 5.',
    );
    expect(name()).toHaveFocus();
    expect(log.AddReview).toHaveLength(0);
  });

  it('avviser navn som bare er mellomrom', async () => {
    const { user, log } = setup();
    await user.type(name(), '     ');
    await user.click(stars(4));
    await user.click(submit());
    expect(name()).toHaveAccessibleDescription('Skriv inn navnet ditt.');
    expect(log.AddReview).toHaveLength(0);
  });

  it('avviser navn over 50 tegn, men godtar nøyaktig 50', async () => {
    const { user, log } = setup();
    await user.click(name());
    await user.paste('a'.repeat(51));
    await user.click(stars(4));
    await user.click(submit());
    expect(name()).toHaveAccessibleDescription(/maks 50 tegn/);
    expect(log.AddReview).toHaveLength(0);

    await user.clear(name());
    await user.paste('a'.repeat(50));
    // Feilen forsvinner så fort feltet er rettet.
    expect(name()).not.toBeInvalid();
    await user.click(submit());
    await waitFor(() => expect(log.AddReview).toHaveLength(1));
  });

  it('avviser innsending uten stjerner', async () => {
    const { user, log } = setup();
    await user.type(name(), 'Kari');
    await user.click(submit());
    expect(screen.getByText('Velg et antall stjerner fra 1 til 5.')).toBeInTheDocument();
    expect(stars(1)).toHaveFocus();
    expect(log.AddReview).toHaveLength(0);
    await user.click(stars(2));
    expect(screen.queryByText('Velg et antall stjerner fra 1 til 5.')).not.toBeInTheDocument();
  });

  it('avviser tekst over 2000 tegn med tydelig melding og rød teller', async () => {
    const { user, log } = setup();
    await user.type(name(), 'Kari');
    await user.click(stars(5));
    await user.click(text());
    await user.paste('x'.repeat(2001));
    expect(screen.getByText('2001 / 2000 tegn')).toBeInTheDocument();
    await user.click(submit());
    expect(text()).toHaveAccessibleDescription(/Teksten kan ha maks 2000 tegn. Fjern 1 tegn./);
    expect(text()).toBeInvalid();
    expect(text()).toHaveFocus();
    expect(log.AddReview).toHaveLength(0);
  });

  it('tåler en svært lang tekst (100 000 tegn) uten å sende den', async () => {
    const { user, log } = setup();
    await user.type(name(), 'Kari');
    await user.click(stars(5));
    await user.click(text());
    await user.paste('y'.repeat(100_000));
    await user.click(submit());
    expect(text()).toHaveAccessibleDescription(/Fjern 98000 tegn/);
    expect(log.AddReview).toHaveLength(0);
  });

  it('teller emoji som ett tegn i telleren og ved validering', async () => {
    const { user, log } = setup();
    await user.type(name(), 'Kari');
    await user.click(stars(5));
    await user.click(text());
    await user.paste('😀'.repeat(2000));
    expect(screen.getByText('2000 / 2000 tegn')).toBeInTheDocument();
    await user.click(submit());
    await waitFor(() => expect(log.AddReview).toHaveLength(1));
  });

  it('teller trimmet tekst i telleren', async () => {
    const { user } = setup();
    await user.click(text());
    await user.paste('  abc  ');
    expect(screen.getByText('3 / 2000 tegn')).toBeInTheDocument();
  });

  it('godtar tom tekst (valgfri) og nøyaktig 2000 tegn', async () => {
    const { user, log } = setup();
    await user.type(name(), 'Kari');
    await user.click(stars(3));
    await user.click(submit());
    await waitFor(() => expect(log.AddReview).toHaveLength(1));
    expect(log.AddReview[0]).toEqual({
      input: { titleId: 'tt0000001', author: 'Kari', rating: 3, text: '' },
    });
    await screen.findByText('Takk! Anmeldelsen din er lagt til.');

    await user.click(stars(3));
    await user.click(text());
    await user.paste('z'.repeat(2000));
    await user.click(submit());
    await waitFor(() => expect(log.AddReview).toHaveLength(2));
  });
});

describe('ReviewForm: innsending', () => {
  it('sender trimmet innhold, viser suksessmelding i live-region, nullstiller og varsler forelderen', async () => {
    const { user, log, onSubmitted } = setup();
    await user.type(name(), '  Kari Nordmann ');
    await user.click(stars(4));
    await user.type(text(), '  Veldig bra!  ');
    await user.click(submit());

    const status = await screen.findByText('Takk! Anmeldelsen din er lagt til.');
    expect(status).toHaveAttribute('role', 'status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(log.AddReview[0]).toEqual({
      input: { titleId: 'tt0000001', author: 'Kari Nordmann', rating: 4, text: 'Veldig bra!' },
    });
    expect(text()).toHaveValue('');
    expect(stars(4)).not.toBeChecked();
    // Navnet beholdes så brukeren slipper å skrive det på nytt.
    expect(name()).toHaveValue('  Kari Nordmann ');
    await waitFor(() => expect(onSubmitted).toHaveBeenCalledTimes(1));
    expect(submit()).toBeEnabled();
  });

  it('deaktiverer knappen under sending og hindrer dobbeltsending', async () => {
    const { user, log } = setup({ delay: 150 });
    await user.type(name(), 'Kari');
    await user.click(stars(4));
    await user.click(submit());
    const button = screen.getByRole('button', { name: 'Sender …' });
    expect(button).toBeDisabled();
    await user.click(button);
    await screen.findByText('Takk! Anmeldelsen din er lagt til.');
    expect(log.AddReview).toHaveLength(1);
    expect(submit()).toBeEnabled();
  });

  it('viser feil ved nettverksfeil, beholder det brukeren skrev, og lar dem prøve igjen', async () => {
    const { user, log } = setup({ failFirst: true });
    await user.type(name(), 'Kari');
    await user.click(stars(2));
    await user.type(text(), 'Ikke helt min greie');
    await user.click(submit());

    expect(await screen.findByRole('alert')).toHaveTextContent('Kunne ikke sende anmeldelsen');
    expect(name()).toHaveValue('Kari');
    expect(stars(2)).toBeChecked();
    expect(text()).toHaveValue('Ikke helt min greie');
    expect(submit()).toBeEnabled();
    expect(screen.queryByText(/Takk!/)).not.toBeInTheDocument();

    await user.click(submit());
    await screen.findByText('Takk! Anmeldelsen din er lagt til.');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(log.AddReview).toHaveLength(1);
  });

  it('sender spesialtegn, HTML og emoji uendret', async () => {
    const { user, log } = setup();
    const nasty = `<img src=x onerror=alert(1)> "sitat" & 'apostrof' æøå 🎬 \\ % _ ; --`;
    await user.type(name(), 'Ola <b>');
    await user.click(stars(5));
    await user.click(text());
    await user.paste(nasty);
    await user.click(submit());
    await screen.findByText('Takk! Anmeldelsen din er lagt til.');
    expect(log.AddReview[0]).toEqual({
      input: { titleId: 'tt0000001', author: 'Ola <b>', rating: 5, text: nasty },
    });
  });
});
