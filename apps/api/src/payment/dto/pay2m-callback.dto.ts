import { IsString, IsOptional, IsNotEmpty, MaxLength, Matches } from 'class-validator';

export class Pay2mCallbackDto {
  // PAY2M error codes are short numeric strings ('00', '000', '104', etc.).
  // Cap at 10 to comfortably accommodate any future code without leaving
  // the field open to unbounded payloads.
  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  err_code!: string;

  // Free-text human-readable message PAY2M may send. Bounded to keep
  // descriptions reasonable; SanitizePipe already strips HTML globally.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  err_msg?: string;

  // Basket IDs are issued server-side as `JDWL-${randomUUID().slice(0,12)}`.
  // The slice contains hex chars and one dash from the UUID structure, so
  // the full shape is `JDWL-` + 12 chars from `[a-f0-9-]`. Total length is
  // exactly 17. The regex bounds + format-checks the field BEFORE the DB
  // lookup — defense-in-depth against a flood of large strings or other
  // basket-ID shapes that aren't ours.
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  @Matches(/^JDWL-[a-f0-9-]{12}$/i, { message: 'Invalid basket id format' })
  basket_id!: string;

  // PAY2M echoes the order_date we sent in initiate. Format from PAY2M docs
  // is "YYYY-MM-DD HH:mm:ss" (19 chars). 30 leaves headroom.
  @IsOptional()
  @IsString()
  @MaxLength(30)
  order_date?: string;

  // PAY2M's gateway transaction ID — opaque alphanumeric. We persist it as
  // payment.gatewayTxnId for reconciliation. Cap at 100 — observed values
  // are <30; 100 is conservative future-proofing.
  @IsOptional()
  @IsString()
  @MaxLength(100)
  transaction_id?: string;

  // SHA-256 hash, exactly 64 hex chars. Service-side regex re-checks this
  // before the timing-safe compare, so any deviation is rejected twice.
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @Matches(/^[a-f0-9]{64}$/i, { message: 'Invalid response key format' })
  Response_Key!: string;

  // Optional human-readable card-network name PAY2M may send (e.g. "Visa").
  @IsOptional()
  @IsString()
  @MaxLength(50)
  PaymentName?: string;

  // Extra fields PAY2M may send — accept but ignore. Bounded to prevent
  // payload bloat reaching our DB even though we don't persist these.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  Rdv_Message_Key?: string;
}

/**
 * PAY2M's server-to-server IPN payload — DISTINCT from the browser callback:
 * the IPN names its hash `responseKey` (not `Response_Key`), carries NO
 * `amount`, and adds `rdv_message_key` — so it would fail Pay2mCallbackDto.
 * We do NOT verify the IPN hash (no amount to hash with); trust comes from the
 * allow-listed source IP (see PaymentService.isTrustedIpnSource). All fields
 * are bounded; only basket_id / err_code / transaction_id are used downstream.
 */
export class Pay2mIpnDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  @Matches(/^JDWL-[a-f0-9-]{12}$/i, { message: 'Invalid basket id format' })
  basket_id!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  err_code!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  err_msg?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  order_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  transaction_id?: string;

  // PAY2M's IPN hash field (camelCase). Accepted + bounded but NOT verified
  // (the IPN has no amount to hash); trust is the source-IP allow-list.
  @IsOptional()
  @IsString()
  @MaxLength(256)
  responseKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  rdv_message_key?: string;
}
