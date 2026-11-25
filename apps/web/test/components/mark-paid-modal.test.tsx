/**
 * Admin "Mark as paid" dialog: the amount is read-only, the transaction id and
 * note are required (same rule as the API DTO), the confirm sends exactly what
 * the admin typed, and a server refusal is shown in the dialog.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import {
  MarkPaidModal, markPaidFormValid, markPaidEffectText, type MarkPaidTarget,
} from '../../src/app/admin/bookings/_components/mark-paid-modal';
import { bookingStateText, gatewayReportText } from '../../src/app/admin/bookings/_components/gateway-payments-table';

const target: MarkPaidTarget = {
  paymentId: 'pay-1', ref: 'JDWL-AED69E16', amount: '1200.00', currency: 'QAR',
  customerName: 'Hamad', basketId: 'JDWL-eb5e0b36-90b', bookingState: 'CANCELLED',
};

describe('markPaidFormValid', () => {
  it('mirrors the API rule: txn 3–64 safe chars, note 5–500 chars', () => {
    expect(markPaidFormValid('PAY2M-1', 'Checked in PAY2M')).toBe(true);
    expect(markPaidFormValid('ab', 'Checked in PAY2M')).toBe(false);
    expect(markPaidFormValid('has space', 'Checked in PAY2M')).toBe(false);
    expect(markPaidFormValid('PAY2M-1', 'ok')).toBe(false);
    expect(markPaidFormValid('  PAY2M-1  ', '  Checked  ')).toBe(true);
    expect(markPaidFormValid('x'.repeat(65), 'Checked in PAY2M')).toBe(false);
  });
});

describe('MarkPaidModal', () => {
  it('shows the fixed amount and basket, explains what confirming does, and keeps Confirm disabled until the form is valid', () => {
    const onConfirm = jest.fn();
    render(<MarkPaidModal target={target} pending={false} error={null} onConfirm={onConfirm} onClose={() => {}} />);
    expect(screen.getByRole('dialog', { name: 'Mark as paid' })).toBeInTheDocument();
    expect(screen.getByTestId('mark-paid-amount')).toHaveTextContent('QAR 1,200');
    expect(screen.getByTestId('mark-paid-basket')).toHaveTextContent('JDWL-eb5e0b36-90b');
    expect(screen.getByText(/cancelled booking is restored/)).toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).toBeNull(); // no amount input

    const confirm = screen.getByRole('button', { name: 'Confirm payment' });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText('PAY2M transaction ID'), { target: { value: 'PAY2M-TXN-9' } });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/^Note/), { target: { value: 'Captured per dashboard' } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith('pay-1', { transactionId: 'PAY2M-TXN-9', note: 'Captured per dashboard' });
  });

  it('shows the server refusal and closes on Escape / Cancel when not pending', () => {
    const onClose = jest.fn();
    render(<MarkPaidModal target={target} pending={false} error="The slot was taken by another booking in the meantime. Nothing was changed." onConfirm={() => {}} onClose={onClose} />);
    expect(screen.getByTestId('mark-paid-error')).toHaveTextContent('slot was taken');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('while pending, the inputs and buttons are disabled', () => {
    const onClose = jest.fn();
    render(<MarkPaidModal target={{ ...target, bookingState: 'PENDING' }} pending error={null} onConfirm={() => {}} onClose={onClose} />);
    expect(screen.getByRole('button', { name: 'Confirming…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(/pending booking is confirmed/)).toBeInTheDocument();
  });

  it('helper texts for the gateway list', () => {
    expect(markPaidEffectText('EXPIRED')).toMatch(/re-created/);
    expect(gatewayReportText({ napsHeldAt: '2026-11-22T07:12:00Z', unverifiedCallbackAt: null, unverifiedCallbackErrCode: null })).toMatch(/^Held since .* awaiting bank confirmation$/);
    expect(gatewayReportText({ napsHeldAt: null, unverifiedCallbackAt: '2026-11-22T07:12:00Z', unverifiedCallbackErrCode: '000' })).toMatch(/^Callback code 000 at .* signature not verified$/);
    expect(bookingStateText({ id: null, ref: 'R', status: 'EXPIRED', exists: false, startDatetime: null, endDatetime: null, cancelledBy: null })).toBe('Expired (deleted by the cleanup)');
    expect(bookingStateText({ id: 'b', ref: 'R', status: 'CANCELLED', exists: true, startDatetime: null, endDatetime: null, cancelledBy: 'CUSTOMER' })).toBe('Cancelled by customer');
    expect(bookingStateText({ id: 'b', ref: 'R', status: 'PENDING', exists: true, startDatetime: null, endDatetime: null, cancelledBy: null })).toBe('Pending');
    expect(bookingStateText(null)).toBe('No booking');
  });
});
