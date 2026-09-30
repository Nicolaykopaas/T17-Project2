import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeTitle } from '../test/utils';
import { TitleRow } from './TitleRow';

const titles = [makeTitle(1), makeTitle(2), makeTitle(3)];

function renderRow(props: Partial<React.ComponentProps<typeof TitleRow>> = {}) {
  return render(
    <MemoryRouter>
      <TitleRow
        heading="Action"
        seeAllTo="/?genres=Action"
        titles={titles}
        loading={false}
        {...props}
      />
    </MemoryRouter>,
  );
}

/** jsdom har ingen layout; vi later som om raden er 300 px bred med 900 px innhold. */
function fakeLayout(scrollWidth: number, clientWidth = 300) {
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(scrollWidth);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(clientWidth);
}

afterEach(() => vi.restoreAllMocks());

describe('TitleRow', () => {
  it('er en region med h2, liste av kort og «Se alle»-lenke', () => {
    renderRow();
    const region = screen.getByRole('region', { name: 'Action' });
    expect(region).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Action' })).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(3);
    expect(screen.getByRole('link', { name: /Se alle/ })).toHaveAttribute(
      'href',
      '/?genres=Action',
    );
  });

  it('skjuler Forrige/Neste når raden ikke kan scrolles', () => {
    fakeLayout(300);
    renderRow();
    expect(screen.queryByRole('button', { name: /Forrige/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Neste/ })).not.toBeInTheDocument();
  });

  it('viser Neste først, og Forrige etter at man har scrollet', () => {
    fakeLayout(900);
    renderRow();
    expect(screen.getByRole('button', { name: 'Neste i Action' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Forrige/ })).not.toBeInTheDocument();

    const list = document.querySelector<HTMLElement>('ul.row__list')!;
    list.scrollLeft = 200;
    fireEvent.scroll(list);
    expect(screen.getByRole('button', { name: 'Forrige i Action' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Neste i Action' })).toBeInTheDocument();

    list.scrollLeft = 600; // 600 + 300 = 900: helt til høyre
    fireEvent.scroll(list);
    expect(screen.queryByRole('button', { name: /Neste/ })).not.toBeInTheDocument();
  });

  it('Neste scroller omtrent en side mot høyre', async () => {
    fakeLayout(900);
    renderRow();
    const list = document.querySelector<HTMLElement>('ul.row__list')!;
    const scrollBy = vi.fn();
    list.scrollBy = scrollBy;
    await userEvent.click(screen.getByRole('button', { name: 'Neste i Action' }));
    expect(scrollBy).toHaveBeenCalledWith(expect.objectContaining({ left: 300 * 0.85 }));
  });

  it('piltaster flytter fokus mellom kortene og stopper i endene', async () => {
    const user = userEvent.setup();
    renderRow();
    const links = screen.getAllByRole('link', { name: /Tittel/ });
    links[0]!.focus();
    await user.keyboard('{ArrowRight}');
    expect(links[1]).toHaveFocus();
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(links[2]).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(links[1]).toHaveFocus();
    links[0]!.focus();
    await user.keyboard('{ArrowLeft}');
    expect(links[0]).toHaveFocus();
  });

  it('viser skjelett mens data lastes, og aria-busy på regionen', () => {
    renderRow({ titles: undefined, loading: true });
    expect(screen.getByTestId('skeleton')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Action', busy: true })).toBeInTheDocument();
  });

  it('viser ingenting når det ikke finnes titler', () => {
    renderRow({ titles: [] });
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('viser feilmelding med «Prøv igjen»', async () => {
    const onRetry = vi.fn();
    renderRow({ titles: undefined, error: true, onRetry });
    await userEvent.click(screen.getByRole('button', { name: 'Prøv igjen' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
