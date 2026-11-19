/**
 * The customer's add-on controls: a whole-group switch that follows the guest
 * count, a per-person picker that clamps to the guests, a per-booking
 * checkbox; 44px targets; the Arabic name on Arabic pages.
 */
import { render, screen, fireEvent } from '@testing-library/react';

let lang = 'en';
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string } & Record<string, unknown>) => {
      const base = opts?.defaultValue ?? key;
      return opts ? base.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(opts[k] ?? '')) : base;
    },
    i18n: { language: lang },
  }),
}));
jest.mock('@/lib/localize', () => ({
  localized: (obj: Record<string, string>, field: string) => (lang === 'ar' ? obj[`${field}Ar`] ?? obj[field] : obj[field]),
}));

import { AddonsPicker } from '../../src/components/addons-picker';

const EXTRAS = [
  { name: 'VIP cabin', nameAr: 'كابينة VIP', price: 100, perPerson: true, wholeGroup: true },
  { name: 'Lunch box', nameAr: 'وجبة غداء', price: 50, perPerson: true },
  { name: 'Photographer', price: 200 },
  { name: 'Water', price: 0 },
];

function setup(selected = new Map<string, number>(), guests = 3) {
  const onChange = jest.fn();
  const utils = render(<AddonsPicker extras={EXTRAS} selected={selected} guests={guests} currency="QAR" onChange={onChange} />);
  return { onChange, ...utils };
}

beforeEach(() => { lang = 'en'; });

describe('AddonsPicker', () => {
  it('renders one control per paid add-on in the right kind, and no inclusion', () => {
    setup();
    expect(screen.getByTestId('addon-0')).toHaveAttribute('data-mode', 'wholeGroup');
    expect(screen.getByTestId('addon-1')).toHaveAttribute('data-mode', 'perPerson');
    expect(screen.getByTestId('addon-2')).toHaveAttribute('data-mode', 'perBooking');
    expect(screen.queryByText('Water')).not.toBeInTheDocument();
    expect(screen.getByText('Optional Add-ons')).toBeInTheDocument(); // heading key fallback
  });

  it('whole group: one switch, priced per person and for every guest; toggling selects every guest', () => {
    const { onChange } = setup(new Map(), 3);
    const sw = screen.getByTestId('addon-0-switch');
    expect(sw).toHaveAttribute('role', 'switch');
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(sw).toHaveTextContent('Upgrade to VIP cabin · +QAR 100 per person');
    expect(sw).toHaveTextContent('× 3 guests · +QAR 300');
    expect(sw.className).toMatch(/min-h-\[56px\]/);
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(new Map([['VIP cabin', 3]]));
  });

  it('whole group: the hint follows the guest count and switching off clears it', () => {
    const { onChange, rerender } = setup(new Map([['VIP cabin', 3]]), 3);
    expect(screen.getByTestId('addon-0-switch')).toHaveAttribute('aria-checked', 'true');
    rerender(<AddonsPicker extras={EXTRAS} selected={new Map([['VIP cabin', 6]])} guests={6} currency="QAR" onChange={onChange} />);
    expect(screen.getByTestId('addon-0-switch')).toHaveTextContent('× 6 guests · +QAR 600');
    fireEvent.click(screen.getByTestId('addon-0-switch'));
    expect(onChange).toHaveBeenLastCalledWith(new Map());
  });

  it('per person: a labelled quantity picker with 44px buttons, clamped to the guests', () => {
    const { onChange } = setup(new Map([['Lunch box', 2]]), 3);
    expect(screen.getByTestId('addon-1')).toHaveTextContent('QAR 50 · per person');
    expect(screen.getByTestId('addon-1')).toHaveTextContent('+QAR 100');
    expect(screen.getByTestId('addon-1-qty')).toHaveTextContent('2');
    const plus = screen.getByTestId('addon-1-plus');
    const minus = screen.getByTestId('addon-1-minus');
    expect(plus.className).toMatch(/h-11 w-11/);
    expect(minus.className).toMatch(/h-11 w-11/);
    fireEvent.click(plus);
    expect(onChange).toHaveBeenLastCalledWith(new Map([['Lunch box', 3]]));
    fireEvent.click(minus);
    expect(onChange).toHaveBeenLastCalledWith(new Map([['Lunch box', 1]]));
  });

  it('per person: plus is disabled at the guest count, minus at zero', () => {
    setup(new Map([['Lunch box', 3]]), 3);
    expect(screen.getByTestId('addon-1-plus')).toBeDisabled();
    expect(screen.getByTestId('addon-1-minus')).toBeEnabled();
  });

  it('per booking: a 44px checkbox row that toggles quantity 1', () => {
    const { onChange } = setup();
    const row = screen.getByTestId('addon-2');
    expect(row).toHaveTextContent('per booking');
    expect(row.querySelector('label')?.className).toMatch(/min-h-11/);
    fireEvent.click(screen.getByTestId('addon-2-checkbox'));
    expect(onChange).toHaveBeenLastCalledWith(new Map([['Photographer', 1]]));
  });

  it('Arabic pages show the add-on\'s Arabic name', () => {
    lang = 'ar';
    setup();
    expect(screen.getByTestId('addon-0-switch')).toHaveTextContent('كابينة VIP');
    expect(screen.getByTestId('addon-1')).toHaveTextContent('وجبة غداء');
    expect(screen.getByTestId('addon-2')).toHaveTextContent('Photographer'); // no Arabic name: English stays
  });

  it('renders nothing when the listing has no paid add-ons', () => {
    const { container } = render(<AddonsPicker extras={[{ name: 'Water', price: 0 }]} selected={new Map()} guests={2} currency="QAR" onChange={jest.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
