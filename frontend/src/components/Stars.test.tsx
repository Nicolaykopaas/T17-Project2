import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Stars } from './Stars';

describe('Stars', () => {
  it('har norsk desimalkomma og én desimal i navnet', () => {
    render(<Stars value={4.333333} />);
    expect(screen.getByRole('img', { name: '4,3 av 5 stjerner' })).toBeInTheDocument();
  });

  it('viser heltall med én desimal', () => {
    render(<Stars value={5} />);
    expect(screen.getByRole('img', { name: '5,0 av 5 stjerner' })).toBeInTheDocument();
  });
});
