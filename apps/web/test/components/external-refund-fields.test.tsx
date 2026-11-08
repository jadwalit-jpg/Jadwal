import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  ExternalRefundChoice,
  validateExternalRefund,
  toExternalRefundPayload,
  selectionFor,
  todayInQatar,
  type ExternalRefundForm,
  type ExternalRefundSelection,
} from '../../src/app/admin/_components/external-refund-fields';

const valid: ExternalRefundForm = { method: 'BANK_TRANSFER', amount: '305', refundedOn: '2026-11-01', reference: 'TRF-1' };

describe('validateExternalRefund (admin cancel dialog and refund queue share it)', () => {
  const today = '2026-11-08';
  it('accepts a complete, valid form', () => {
    expect(validateExternalRefund(valid, 305, today)).toEqual({});
  });
  it('requires a method', () => {
    expect(validateExternalRefund({ ...valid, method: '' }, 305, today).method).toMatch(/Choose how/);
  });
  it('amount must be above 0, at most the cash paid, with 2 decimals', () => {
    expect(validateExternalRefund({ ...valid, amount: '0' }, 305, today).amount).toMatch(/above 0/);
    expect(validateExternalRefund({ ...valid, amount: '' }, 305, today).amount).toMatch(/Enter the amount/);
    expect(validateExternalRefund({ ...valid, amount: '305.01' }, 305, today).amount).toMatch(/cannot exceed/);
    expect(validateExternalRefund({ ...valid, amount: '10.123' }, 305, today).amount).toMatch(/2 decimals/);
    expect(validateExternalRefund({ ...valid, amount: '305' }, 305, today).amount).toBeUndefined();
    // Two-decimal amounts whose *100 is inexact in doubles (1.15 * 100 = 114.99999999999999) are still valid.
    for (const amount of ['1.15', '152.55', '305.1', '0.29', '19.99']) {
      expect(validateExternalRefund({ ...valid, amount }, 400, today).amount).toBeUndefined();
    }
    expect(validateExternalRefund({ ...valid, amount: '1.155' }, 400, today).amount).toMatch(/2 decimals/);
  });
  it('date is required and cannot be in the future', () => {
    expect(validateExternalRefund({ ...valid, refundedOn: '' }, 305, today).refundedOn).toMatch(/Enter the refund date/);
    expect(validateExternalRefund({ ...valid, refundedOn: '2026-11-09' }, 305, today).refundedOn).toMatch(/future/);
    expect(validateExternalRefund({ ...valid, refundedOn: '2026-11-08' }, 305, today).refundedOn).toBeUndefined();
  });
  it('reference is optional but capped at 200 characters', () => {
    expect(validateExternalRefund({ ...valid, reference: '' }, 305, today).reference).toBeUndefined();
    expect(validateExternalRefund({ ...valid, reference: 'x'.repeat(201) }, 305, today).reference).toMatch(/200/);
  });
  it('builds the payload with a rounded amount and no empty reference', () => {
    expect(toExternalRefundPayload({ ...valid, amount: '100.1', reference: '  ' })).toEqual({ method: 'BANK_TRANSFER', amount: 100.1, refundedOn: '2026-11-01' });
    expect(toExternalRefundPayload(valid)).toEqual({ method: 'BANK_TRANSFER', amount: 305, refundedOn: '2026-11-01', reference: 'TRF-1' });
  });
  it('selectionFor: no choice is never ready; points is ready without a payload; outside needs valid fields', () => {
    expect(selectionFor(null, valid, 305)).toEqual({ choice: null, ready: false, payload: undefined });
    expect(selectionFor('POINTS', valid, 305)).toEqual({ choice: 'POINTS', ready: true, payload: undefined });
    expect(selectionFor('OUTSIDE', { ...valid, method: '' }, 305).ready).toBe(false);
    expect(selectionFor('OUTSIDE', valid, 305)).toMatchObject({ choice: 'OUTSIDE', ready: true, payload: { method: 'BANK_TRANSFER', amount: 305 } });
  });
  it("today's date is a Qatar calendar date", () => {
    // 2026-11-08 21:30Z is already 2026-11-09 00:30 in Qatar.
    expect(todayInQatar(new Date('2026-11-08T21:30:00.000Z'))).toBe('2026-11-09');
    expect(todayInQatar(new Date('2026-11-08T20:30:00.000Z'))).toBe('2026-11-08');
  });
});

describe('ExternalRefundChoice (the Refund Queue approve option)', () => {
  it('starts with no choice, reports points as ready without a payload', async () => {
    const onChange = jest.fn<void, [ExternalRefundSelection]>();
    render(<ExternalRefundChoice cashPaid={100} currency="QAR" idPrefix="q" onChange={onChange} />);
    expect(screen.getByRole('radio', { name: /Refund as Wanasa points/ })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: /Refund already done outside the website/ })).not.toBeChecked();
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('radio', { name: /Refund as Wanasa points/ }));
    expect(onChange).toHaveBeenLastCalledWith({ choice: 'POINTS', ready: true, payload: undefined });
  });

  it('outside: shows method, amount (pre-filled with the cash paid), date (today) and reference; ready only once valid', async () => {
    const onChange = jest.fn<void, [ExternalRefundSelection]>();
    render(<ExternalRefundChoice cashPaid={100} currency="QAR" idPrefix="q" onChange={onChange} />);
    await userEvent.click(screen.getByRole('radio', { name: /Refund already done outside the website/ }));
    // Method not chosen yet → not ready, error shown.
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ choice: 'OUTSIDE', ready: false }));
    expect(screen.getByText('Choose how the refund was made')).toBeInTheDocument();
    expect(screen.getByLabelText(/Amount refunded/)).toHaveValue(100);
    expect(screen.getByLabelText(/Refund date/)).toHaveValue(todayInQatar());

    await userEvent.selectOptions(screen.getByLabelText(/Method/), 'BANK_TRANSFER');
    expect(onChange).toHaveBeenLastCalledWith({
      choice: 'OUTSIDE', ready: true, payload: { method: 'BANK_TRANSFER', amount: 100, refundedOn: todayInQatar() },
    });
    expect(screen.getByTestId('q-outside-summary')).toHaveTextContent(
      'No Wanasa points will be added for the QAR 100. The customer will be told the refund was made by bank transfer.',
    );

    // Over the cash paid → not ready, error shown.
    await userEvent.clear(screen.getByLabelText(/Amount refunded/));
    await userEvent.type(screen.getByLabelText(/Amount refunded/), '150');
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ ready: false }));
    expect(screen.getByText(/cannot exceed the cash paid \(100\)/)).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText(/Amount refunded/));
    await userEvent.type(screen.getByLabelText(/Amount refunded/), '80');
    await userEvent.type(screen.getByLabelText(/Reference or note/), 'TRF-9');
    expect(onChange).toHaveBeenLastCalledWith({
      choice: 'OUTSIDE', ready: true, payload: { method: 'BANK_TRANSFER', amount: 80, refundedOn: todayInQatar(), reference: 'TRF-9' },
    });
  });
});
