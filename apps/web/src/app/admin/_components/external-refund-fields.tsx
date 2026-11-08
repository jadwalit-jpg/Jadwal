'use client';

import { useMemo, useState } from 'react';
import { nowInQatarAsUtc } from '../bookings/_components/cancel-booking-modal';

/**
 * "Refund already done outside the website" — the shared choice and fields
 * used by the admin cancel dialog and by the admin approve in the refund
 * queue. The server (ExternalRefundDto + assertExternalRefundAllowed) checks
 * everything again; this only gives the admin the errors before the click.
 *
 * Admin panel: English only, like every other admin page.
 */

export const REFUND_METHODS = ['BANK_TRANSFER', 'CASH', 'CARD_PAY2M', 'OTHER'] as const;
export type RefundMethod = (typeof REFUND_METHODS)[number];

export const REFUND_METHOD_LABEL: Record<RefundMethod, string> = {
  BANK_TRANSFER: 'Bank transfer',
  CASH: 'Cash',
  CARD_PAY2M: 'Card refund in PAY2M',
  OTHER: 'Other',
};

export type RefundChoice = 'POINTS' | 'OUTSIDE' | null;

export type ExternalRefundPayload = {
  method: RefundMethod;
  amount: number;
  refundedOn: string;
  reference?: string;
};

/** Today's date in Qatar, YYYY-MM-DD (booking dates on this site are Qatar dates). */
export function todayInQatar(now: Date = new Date()): string {
  return nowInQatarAsUtc(now).toISOString().slice(0, 10);
}

export type ExternalRefundForm = {
  method: RefundMethod | '';
  amount: string;
  refundedOn: string;
  reference: string;
};

export type ExternalRefundErrors = Partial<Record<keyof ExternalRefundForm, string>>;

/** Pure validation of the outside-refund fields against the cash paid. */
export function validateExternalRefund(form: ExternalRefundForm, cashPaid: number, today = todayInQatar()): ExternalRefundErrors {
  const errors: ExternalRefundErrors = {};
  if (!form.method) errors.method = 'Choose how the refund was made';
  const amt = Number(form.amount);
  if (form.amount.trim() === '' || !Number.isFinite(amt)) errors.amount = 'Enter the amount refunded';
  else if (amt <= 0) errors.amount = 'Amount must be above 0';
  else if (amt > cashPaid + 1e-9) errors.amount = `Amount cannot exceed the cash paid (${cashPaid.toLocaleString()})`;
  // Tolerance, not equality: 1.15 * 100 is 114.99999999999999 in doubles, and the same goes for about one two-decimal amount in ten.
  else if (Math.abs(amt * 100 - Math.round(amt * 100)) > 1e-6) errors.amount = 'Use at most 2 decimals';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.refundedOn)) errors.refundedOn = 'Enter the refund date';
  else if (form.refundedOn > today) errors.refundedOn = 'The refund date cannot be in the future';
  if (form.reference.length > 200) errors.reference = 'Keep the reference under 200 characters';
  return errors;
}

export function toExternalRefundPayload(form: ExternalRefundForm): ExternalRefundPayload {
  const reference = form.reference.trim();
  return {
    method: form.method as RefundMethod,
    amount: Number(Number(form.amount).toFixed(2)),
    refundedOn: form.refundedOn,
    ...(reference ? { reference } : {}),
  };
}

export type ExternalRefundState = {
  choice: RefundChoice;
  setChoice: (c: RefundChoice) => void;
  form: ExternalRefundForm;
  update: (patch: Partial<ExternalRefundForm>) => void;
  errors: ExternalRefundErrors;
  outsideValid: boolean;
  ready: boolean;
  payload: () => ExternalRefundPayload | undefined;
};

export function initialExternalRefundForm(cashPaid: number): ExternalRefundForm {
  return { method: '', amount: cashPaid > 0 ? String(cashPaid) : '', refundedOn: todayInQatar(), reference: '' };
}

/** Form state for the outside-refund fields, pre-filled with the cash paid and today's date. */
export function useExternalRefundForm(cashPaid: number): ExternalRefundState {
  const [choice, setChoice] = useState<RefundChoice>(null);
  const [form, setForm] = useState<ExternalRefundForm>(() => initialExternalRefundForm(cashPaid));
  const errors = useMemo(() => validateExternalRefund(form, cashPaid), [form, cashPaid]);
  const outsideValid = Object.keys(errors).length === 0;
  /** The admin has made a complete, valid choice. */
  const ready = choice === 'POINTS' || (choice === 'OUTSIDE' && outsideValid);
  const update = (patch: Partial<ExternalRefundForm>) => setForm((f) => ({ ...f, ...patch }));
  const payload = (): ExternalRefundPayload | undefined => (choice === 'OUTSIDE' ? toExternalRefundPayload(form) : undefined);
  return { choice, setChoice, form, update, errors, outsideValid, ready, payload };
}

const inputCls = (bad: boolean) =>
  `w-full px-3 py-2 bg-white dark:bg-slate-800 border rounded-xl text-sm text-gray-900 dark:text-white outline-none focus:ring-1 ${
    bad ? 'border-red-400 focus:border-red-500 focus:ring-red-500' : 'border-gray-200 dark:border-slate-700 focus:border-emerald-500 focus:ring-emerald-500'
  }`;

/**
 * The choice (points vs outside) and, for "outside", the method / amount /
 * date / reference fields. `cashPaid` is the card amount the customer paid.
 * `idPrefix` keeps ids unique when two dialogs exist on one page.
 */
export function ExternalRefundFields({
  state,
  cashPaid,
  currency,
  disabled,
  idPrefix = 'refund',
  pointsLabel = 'Refund as Wanasa points',
  pointsHint = `The ${currency} ${cashPaid.toLocaleString()} paid is credited to the customer's Wanasa balance.`,
}: {
  state: ExternalRefundState;
  cashPaid: number;
  currency: string;
  disabled?: boolean;
  idPrefix?: string;
  pointsLabel?: string;
  pointsHint?: string;
}) {
  const { choice, setChoice, form, update, errors } = state;
  const showErrors = choice === 'OUTSIDE';
  const methodLabel = form.method ? REFUND_METHOD_LABEL[form.method as RefundMethod] : null;

  return (
    <fieldset className="mb-4" disabled={disabled}>
      <legend className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-2">
        Refund <span className="text-red-500">*</span>
      </legend>
      <div className="space-y-2">
        <label className={`flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer ${choice === 'POINTS' ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-900/10' : 'border-gray-200 dark:border-slate-700'}`}>
          <input type="radio" name={`${idPrefix}-choice`} value="POINTS" checked={choice === 'POINTS'} onChange={() => setChoice('POINTS')} className="mt-0.5" />
          <span>
            <span className="block text-sm font-semibold text-gray-900 dark:text-white">{pointsLabel}</span>
            <span className="block text-xs text-gray-500 dark:text-slate-400">{pointsHint}</span>
          </span>
        </label>
        <label className={`flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer ${choice === 'OUTSIDE' ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-900/10' : 'border-gray-200 dark:border-slate-700'}`}>
          <input type="radio" name={`${idPrefix}-choice`} value="OUTSIDE" checked={choice === 'OUTSIDE'} onChange={() => setChoice('OUTSIDE')} className="mt-0.5" />
          <span>
            <span className="block text-sm font-semibold text-gray-900 dark:text-white">Refund already done outside the website</span>
            <span className="block text-xs text-gray-500 dark:text-slate-400">Bank transfer, cash, a card refund in PAY2M or another way. No Wanasa points are added for the cash.</span>
          </span>
        </label>
      </div>

      {choice === 'OUTSIDE' && (
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="col-span-2 sm:col-span-1">
            <label htmlFor={`${idPrefix}-method`} className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1">Method <span className="text-red-500">*</span></label>
            <select id={`${idPrefix}-method`} value={form.method} onChange={(e) => update({ method: e.target.value as RefundMethod | '' })} className={inputCls(showErrors && !!errors.method)}>
              <option value="">Select method</option>
              {REFUND_METHODS.map((m) => <option key={m} value={m}>{REFUND_METHOD_LABEL[m]}</option>)}
            </select>
            {showErrors && errors.method && <p className="text-[11px] text-red-600 mt-1">{errors.method}</p>}
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label htmlFor={`${idPrefix}-amount`} className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1">Amount refunded ({currency}) <span className="text-red-500">*</span></label>
            <input id={`${idPrefix}-amount`} type="number" step="0.01" min="0.01" max={cashPaid} value={form.amount} onChange={(e) => update({ amount: e.target.value })} className={inputCls(showErrors && !!errors.amount)} />
            <p className="text-[11px] text-gray-500 dark:text-slate-400 mt-1">Cash paid: {currency} {cashPaid.toLocaleString()}</p>
            {showErrors && errors.amount && <p className="text-[11px] text-red-600 mt-1">{errors.amount}</p>}
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label htmlFor={`${idPrefix}-date`} className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1">Refund date <span className="text-red-500">*</span></label>
            <input id={`${idPrefix}-date`} type="date" value={form.refundedOn} max={todayInQatar()} onChange={(e) => update({ refundedOn: e.target.value })} className={inputCls(showErrors && !!errors.refundedOn)} />
            {showErrors && errors.refundedOn && <p className="text-[11px] text-red-600 mt-1">{errors.refundedOn}</p>}
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label htmlFor={`${idPrefix}-reference`} className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1">Reference or note <span className="text-gray-400 font-normal">(optional)</span></label>
            <input id={`${idPrefix}-reference`} type="text" maxLength={200} value={form.reference} onChange={(e) => update({ reference: e.target.value })} placeholder="e.g. transfer number" className={inputCls(showErrors && !!errors.reference)} />
            {showErrors && errors.reference && <p className="text-[11px] text-red-600 mt-1">{errors.reference}</p>}
          </div>
          <p className="col-span-2 text-xs font-medium text-amber-700 dark:text-amber-400" data-testid={`${idPrefix}-outside-summary`}>
            No Wanasa points will be added for the {currency} {form.amount || cashPaid.toLocaleString()}.
            {methodLabel ? ` The customer will be told the refund was made by ${methodLabel.toLowerCase()}.` : ' The customer will be told how the refund was made.'}
          </p>
        </div>
      )}
    </fieldset>
  );
}

export type ExternalRefundSelection = {
  choice: RefundChoice;
  /** A complete, valid choice was made (points, or outside with valid fields). */
  ready: boolean;
  /** Set only for a valid "outside" choice. */
  payload?: ExternalRefundPayload;
};

export function selectionFor(choice: RefundChoice, form: ExternalRefundForm, cashPaid: number): ExternalRefundSelection {
  const valid = Object.keys(validateExternalRefund(form, cashPaid)).length === 0;
  const ready = choice === 'POINTS' || (choice === 'OUTSIDE' && valid);
  return { choice, ready, payload: choice === 'OUTSIDE' && valid ? toExternalRefundPayload(form) : undefined };
}

/**
 * Self-contained choice block for a dialog that keeps its own open/close
 * state (the refund-queue approve modals): owns the form state and reports
 * every change up through `onChange`, from the change handlers themselves.
 * Mount it with a `key` per booking so a new booking starts un-chosen.
 */
export function ExternalRefundChoice({
  cashPaid,
  currency,
  disabled,
  idPrefix,
  pointsLabel,
  pointsHint,
  onChange,
}: {
  cashPaid: number;
  currency: string;
  disabled?: boolean;
  idPrefix?: string;
  pointsLabel?: string;
  pointsHint?: string;
  onChange: (selection: ExternalRefundSelection) => void;
}) {
  const [choice, setChoiceRaw] = useState<RefundChoice>(null);
  const [form, setFormRaw] = useState<ExternalRefundForm>(() => initialExternalRefundForm(cashPaid));
  const errors = useMemo(() => validateExternalRefund(form, cashPaid), [form, cashPaid]);
  const setChoice = (c: RefundChoice) => {
    setChoiceRaw(c);
    onChange(selectionFor(c, form, cashPaid));
  };
  const update = (patch: Partial<ExternalRefundForm>) => {
    const next = { ...form, ...patch };
    setFormRaw(next);
    onChange(selectionFor(choice, next, cashPaid));
  };
  const selection = selectionFor(choice, form, cashPaid);
  const state: ExternalRefundState = {
    choice, setChoice, form, update, errors,
    outsideValid: Object.keys(errors).length === 0,
    ready: selection.ready,
    payload: () => selection.payload,
  };
  return (
    <ExternalRefundFields
      state={state}
      cashPaid={cashPaid}
      currency={currency}
      disabled={disabled}
      idPrefix={idPrefix}
      pointsLabel={pointsLabel}
      pointsHint={pointsHint}
    />
  );
}
