/**
 * SnsSignatureValidator unit tests.
 *
 * Strategy:
 *   - Generate an RSA keypair in-memory.
 *   - Sign known-good canonicals with the private key.
 *   - Stub `getCert` to return the public key PEM (Node's createVerify
 *     accepts an SPKI PEM the same way it accepts a full X.509 cert).
 *
 * This lets us exercise every branch (canonical builder, signature
 * algorithm dispatch, mismatch detection) without hitting the network
 * or carrying a real AWS cert through git.
 */

import { createSign, generateKeyPairSync, KeyObject } from 'crypto';
import {
  SnsSignatureValidator,
  type SnsSignedMessage,
} from '../../src/email/sns-signature-validator.service';

let publicKeyPem: string;
let privateKey: KeyObject;

beforeAll(() => {
  const kp = generateKeyPairSync('rsa', { modulusLength: 2048 });
  privateKey = kp.privateKey;
  publicKeyPem = kp.publicKey.export({ type: 'spki', format: 'pem' }).toString();
});

const VALID_CERT_URL =
  'https://sns.eu-central-1.amazonaws.com/SimpleNotificationService-abc123def456.pem';

function makeValidator(): SnsSignatureValidator {
  const v = new SnsSignatureValidator();
  // Stub the private cert fetcher to return our test public key — bypasses
  // the network call and the X509Certificate parse step (the real fetcher
  // expects a full X.509, but createVerify().verify() accepts an SPKI PEM
  // identically, so signature math is exercised end-to-end).
  jest.spyOn(v as unknown as { getCert: () => Promise<string> }, 'getCert')
    .mockResolvedValue(publicKeyPem);
  return v;
}

function signCanonical(canonical: string, algorithm: 'SHA1' | 'SHA256'): string {
  const signer = createSign(algorithm);
  signer.update(canonical, 'utf8');
  return signer.sign(privateKey).toString('base64');
}

function makeNotification(overrides: Partial<SnsSignedMessage> = {}): SnsSignedMessage {
  return {
    Type: 'Notification',
    MessageId: 'msg-id-1',
    TopicArn: 'arn:aws:sns:eu-central-1:362730983562:jadwal-ses-bounces',
    Message: '{"hello":"world"}',
    Timestamp: '2026-05-09T10:00:00.000Z',
    SignatureVersion: '1',
    Signature: '',
    SigningCertURL: VALID_CERT_URL,
    Subject: undefined,
    ...overrides,
  };
}

function makeSubscription(overrides: Partial<SnsSignedMessage> = {}): SnsSignedMessage {
  return {
    Type: 'SubscriptionConfirmation',
    MessageId: 'sub-msg-1',
    TopicArn: 'arn:aws:sns:eu-central-1:362730983562:jadwal-ses-bounces',
    Message: 'You have chosen to subscribe…',
    Timestamp: '2026-05-09T10:00:00.000Z',
    SignatureVersion: '1',
    Signature: '',
    SigningCertURL: VALID_CERT_URL,
    Token: 'opaque-token-AbCdEf',
    SubscribeURL: 'https://sns.eu-central-1.amazonaws.com/?Action=ConfirmSubscription&TopicArn=arn&Token=opaque-token-AbCdEf',
    ...overrides,
  };
}

describe('SnsSignatureValidator — canonical building', () => {
  const v = new SnsSignatureValidator();

  test('Notification without Subject — alphabetical order, no Subject line', () => {
    const c = v.buildCanonical(makeNotification({ Subject: undefined }));
    expect(c).toBe(
      [
        'Message', '{"hello":"world"}',
        'MessageId', 'msg-id-1',
        'Timestamp', '2026-05-09T10:00:00.000Z',
        'TopicArn', 'arn:aws:sns:eu-central-1:362730983562:jadwal-ses-bounces',
        'Type', 'Notification',
        '',
      ].join('\n'),
    );
  });

  test('Notification WITH Subject — Subject inserted between MessageId and Timestamp', () => {
    const c = v.buildCanonical(makeNotification({ Subject: 'hello' }));
    expect(c).toContain('\nMessageId\nmsg-id-1\nSubject\nhello\nTimestamp\n');
  });

  test('SubscriptionConfirmation — Token + SubscribeURL inserted alphabetically', () => {
    const c = v.buildCanonical(makeSubscription());
    expect(c).toContain('\nMessageId\nsub-msg-1\nSubscribeURL\nhttps://sns');
    expect(c).toContain('\nTimestamp\n2026-05-09T10:00:00.000Z\nToken\nopaque-token-AbCdEf\n');
  });

  test('SubscriptionConfirmation missing Token → null (caller treats as mismatch)', () => {
    const c = v.buildCanonical(makeSubscription({ Token: undefined }));
    expect(c).toBeNull();
  });

  test('Unsupported Type → null', () => {
    const c = v.buildCanonical({ ...makeNotification(), Type: 'Heartbeat' as any });
    expect(c).toBeNull();
  });
});

describe('SnsSignatureValidator — cert URL validation', () => {
  const v = new SnsSignatureValidator();

  test.each([
    ['attacker.com pretending to be sns', 'https://attacker.com/SimpleNotificationService-x.pem'],
    ['cross-region path traversal', 'https://sns.us-east-1.amazonaws.com/../../evil.pem'],
    ['HTTP not HTTPS', 'http://sns.eu-central-1.amazonaws.com/SimpleNotificationService-x.pem'],
    ['cert path with non-pem extension', 'https://sns.eu-central-1.amazonaws.com/SimpleNotificationService-x.txt'],
    ['cert path with ?query injection', 'https://sns.eu-central-1.amazonaws.com/SimpleNotificationService-x.pem?evil=1'],
  ])('rejects %s', async (_label, badUrl) => {
    const result = await v.validate(makeNotification({ SigningCertURL: badUrl }));
    expect(result).toEqual({ valid: false, reason: 'invalid_cert_url' });
  });

  test('accepts valid commercial-region URL', async () => {
    const v2 = makeValidator();
    const msg = makeNotification();
    const canonical = v2.buildCanonical(msg)!;
    msg.Signature = signCanonical(canonical, 'SHA1');
    await expect(v2.validate(msg)).resolves.toEqual({ valid: true });
  });

  test('accepts valid China-region URL', async () => {
    const v2 = makeValidator();
    const msg = makeNotification({
      SigningCertURL: 'https://sns.cn-north-1.amazonaws.com.cn/SimpleNotificationService-cnabc.pem',
    });
    const canonical = v2.buildCanonical(msg)!;
    msg.Signature = signCanonical(canonical, 'SHA1');
    await expect(v2.validate(msg)).resolves.toEqual({ valid: true });
  });
});

describe('SnsSignatureValidator — signature verification', () => {
  test('valid SHA1 (SignatureVersion=1) signature → valid: true', async () => {
    const v = makeValidator();
    const msg = makeNotification({ SignatureVersion: '1' });
    const canonical = v.buildCanonical(msg)!;
    msg.Signature = signCanonical(canonical, 'SHA1');
    await expect(v.validate(msg)).resolves.toEqual({ valid: true });
  });

  test('valid SHA256 (SignatureVersion=2) signature → valid: true', async () => {
    const v = makeValidator();
    const msg = makeNotification({ SignatureVersion: '2' });
    const canonical = v.buildCanonical(msg)!;
    msg.Signature = signCanonical(canonical, 'SHA256');
    await expect(v.validate(msg)).resolves.toEqual({ valid: true });
  });

  test('tampered Message → signature_mismatch', async () => {
    const v = makeValidator();
    const original = makeNotification();
    const canonical = v.buildCanonical(original)!;
    const validSignature = signCanonical(canonical, 'SHA1');
    // Same signature, different Message → fingerprint won't match
    const tampered = { ...original, Message: '{"hello":"injected"}', Signature: validSignature };
    await expect(v.validate(tampered)).resolves.toEqual({
      valid: false,
      reason: 'signature_mismatch',
    });
  });

  test('unsupported SignatureVersion → unsupported_signature_version', async () => {
    const v = makeValidator();
    const msg = makeNotification({ SignatureVersion: '99' });
    msg.Signature = signCanonical(v.buildCanonical(msg)!, 'SHA1');
    await expect(v.validate(msg)).resolves.toEqual({
      valid: false,
      reason: 'unsupported_signature_version',
    });
  });

  test('invalid base64 signature → invalid_signature_encoding', async () => {
    const v = makeValidator();
    const msg = makeNotification({ Signature: '' });
    await expect(v.validate(msg)).resolves.toEqual({
      valid: false,
      reason: 'invalid_signature_encoding',
    });
  });

  test('cert fetch failure → cert_fetch_failed', async () => {
    const v = new SnsSignatureValidator();
    jest.spyOn(v as unknown as { getCert: () => Promise<string> }, 'getCert')
      .mockRejectedValue(new Error('network unreachable'));
    const msg = makeNotification();
    msg.Signature = signCanonical(v.buildCanonical(msg)!, 'SHA1');
    await expect(v.validate(msg)).resolves.toEqual({
      valid: false,
      reason: 'cert_fetch_failed',
    });
  });

  test('Subject is signed when present (regression — drop Subject from canonical breaks verification)', async () => {
    const v = makeValidator();
    const msg = makeNotification({ Subject: 'real subject' });
    msg.Signature = signCanonical(v.buildCanonical(msg)!, 'SHA1');
    // First confirm valid as-is
    await expect(v.validate(msg)).resolves.toEqual({ valid: true });
    // Now strip Subject — same signature is no longer over the same canonical
    const subjectStripped: SnsSignedMessage = { ...msg, Subject: undefined };
    await expect(v.validate(subjectStripped)).resolves.toEqual({
      valid: false,
      reason: 'signature_mismatch',
    });
  });

  test('SubscriptionConfirmation full path — canonical includes Token + SubscribeURL', async () => {
    const v = makeValidator();
    const msg = makeSubscription();
    msg.Signature = signCanonical(v.buildCanonical(msg)!, 'SHA1');
    await expect(v.validate(msg)).resolves.toEqual({ valid: true });
  });
});
