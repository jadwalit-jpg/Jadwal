/** Five 44px star buttons; the chosen one is checked; clicks report 1..5. */
import { render, screen, fireEvent } from '@testing-library/react';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string } & Record<string, unknown>) => {
      const base = opts?.defaultValue ?? key;
      return opts ? base.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(opts[k] ?? '')) : base;
    },
  }),
}));

import { ReviewStars } from '../../src/components/review-stars';

describe('ReviewStars', () => {
  it('renders five radio stars, marks the value checked, and reports clicks', () => {
    const onChange = jest.fn();
    render(<ReviewStars value={3} onChange={onChange} />);
    const stars = screen.getAllByRole('radio');
    expect(stars).toHaveLength(5);
    expect(stars[2]).toHaveAttribute('aria-checked', 'true');
    expect(stars[4]).toHaveAttribute('aria-checked', 'false');
    expect(stars[4]).toHaveAttribute('aria-label', '5 stars');
    expect(stars[0].className).toMatch(/h-11 w-11/);
    fireEvent.click(stars[4]);
    expect(onChange).toHaveBeenCalledWith(5);
  });

  it('is inert while disabled', () => {
    const onChange = jest.fn();
    render(<ReviewStars value={0} onChange={onChange} disabled />);
    fireEvent.click(screen.getByTestId('review-star-2'));
    expect(onChange).not.toHaveBeenCalled();
  });
});
