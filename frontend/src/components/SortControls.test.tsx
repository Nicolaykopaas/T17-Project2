import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EMPTY_STATE } from '../lib/searchState';
import { SortControls } from './SortControls';

describe('SortControls', () => {
  it('kaller standardvalget «Popularitet» når søket er tomt', () => {
    render(<SortControls state={EMPTY_STATE} onChange={vi.fn()} />);
    const select = screen.getByRole('combobox', { name: 'Sorter etter' });
    expect(select).toHaveDisplayValue('Popularitet');
    expect(screen.queryByRole('option', { name: 'Relevans' })).not.toBeInTheDocument();
  });

  it('behandler blanke søk som tomme', () => {
    render(<SortControls state={{ ...EMPTY_STATE, q: '   ' }} onChange={vi.fn()} />);
    expect(screen.getByRole('combobox', { name: 'Sorter etter' })).toHaveDisplayValue(
      'Popularitet',
    );
  });

  it('kaller valget «Relevans» når det finnes søketekst', () => {
    render(<SortControls state={{ ...EMPTY_STATE, q: 'matrix' }} onChange={vi.fn()} />);
    expect(screen.getByRole('combobox', { name: 'Sorter etter' })).toHaveDisplayValue('Relevans');
    expect(screen.queryByRole('option', { name: 'Popularitet' })).not.toBeInTheDocument();
  });

  it('sender samme enum-verdi uavhengig av etikett', async () => {
    const onChange = vi.fn();
    render(<SortControls state={{ ...EMPTY_STATE, sort: 'YEAR' }} onChange={onChange} />);
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Sorter etter' }),
      'Popularitet',
    );
    expect(onChange).toHaveBeenCalledWith({ sort: 'RELEVANCE', dir: null });
  });
});
