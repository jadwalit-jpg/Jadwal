/**
 * SesEventsController unit tests.
 *
 * Security-critical paths:
 *   - Wrong/unknown TopicArn → 403 (drop before signature verify)
 *   - Bad SNS signature → 403
 *   - Permanent bounce → suppression upserted
 *   - Transient bounce → ignored (do NOT suppress legit recipients on
 *     temporary failures like greylisting / mailbox full)
 *   - Complaint → suppressed unconditionally
 *   - SubscriptionConfirmation → SubscribeURL fetched once
 *
 * sns-validator is mocked to flip between accept/reject so we don't need
 * AWS X.509 fixtures in the test fixture.
 */

import { ForbiddenException } from '@nestjs/common';

// sns-validator: shared mock that flips behaviour per-test via __setOk(...)
let validatorOk = true;
jest.mock('sns-validator', () => {
  return jest.fn().mockImplementation(() => ({
    validate: (_msg: any, cb: (err: Error | null) => void) => {
      if (validatorOk) cb(null);
      else cb(new Error('signature invalid'));
    },
  }));
});

// global fetch mock for SubscribeURL
const fetchMock = jest.fn().mockResolvedValue(undefined);
(global as any).fetch = fetchMock;

import { SesEventsController } from '../../src/email/ses-events.controller';

const KNOWN_BOUNCES_ARN = 'arn:aws:sns:eu-central-1:1:jadwal-ses-bounces';
const KNOWN_COMPLAINTS_ARN = 'arn:aws:sns:eu-central-1:1:jadwal-ses-complaints';

function makeSut(opts: { signatureOk?: boolean } = {}) {
  validatorOk = opts.signatureOk ?? true;
  const config = {
    get: (k: string) => {
      if (k === 'SNS_TOPIC_ARN_BOUNCES') return KNOWN_BOUNCES_ARN;
      if (k === 'SNS_TOPIC_ARN_COMPLAINTS') return KNOWN_COMPLAINTS_ARN;
      return undefined;
    },
  };
  const suppressions = {
    suppress: jest.fn().mockResolvedValue(undefined),
    isSuppressed: jest.fn(),
    unsuppress: jest.fn(),
  };
  const sut = new SesEventsController(config as any, suppressions as any);
  return { sut, suppressions };
}

function makeBounceMessage(emailAddress: string, bounceType: 'Permanent' | 'Transient' = 'Permanent') {
  return {
    Type: 'Notification',
    MessageId: 'msg-1',
    TopicArn: KNOWN_BOUNCES_ARN,
    Timestamp: '2026-05-03T10:00:00Z',
    SignatureVersion: '1',
    Signature: 'sig',
    SigningCertURL: 'https://sns.../cert.pem',
    Message: JSON.stringify({
      notificationType: 'Bounce',
      bounce: {
        bounceType,
        bounceSubType: 'General',
        bouncedRecipients: [{ emailAddress, status: '5.0.0', diagnosticCode: 'mx hard-fail' }],
        timestamp: '2026-05-03T10:00:00Z',
      },
    }),
  };
}

function makeComplaintMessage(emailAddress: string) {
  return {
    Type: 'Notification',
    MessageId: 'msg-2',
    TopicArn: KNOWN_COMPLAINTS_ARN,
    Timestamp: '2026-05-03T10:00:00Z',
    SignatureVersion: '1',
    Signature: 'sig',
    SigningCertURL: 'https://sns.../cert.pem',
    Message: JSON.stringify({
      notificationType: 'Complaint',
      complaint: {
        complainedRecipients: [{ emailAddress }],
        complaintFeedbackType: 'abuse',
        timestamp: '2026-05-03T10:00:00Z',
      },
    }),
  };
}

describe('SesEventsController.handle — auth gates', () => {
  test('missing message-type header → 403', async () => {
    const { sut } = makeSut();
    await expect(sut.handle(undefined, makeBounceMessage('x@b.com') as any)).rejects.toThrow(ForbiddenException);
  });

  test('unknown TopicArn → 403 (drop before signature verify)', async () => {
    const { sut, suppressions } = makeSut();
    const msg = makeBounceMessage('x@b.com');
    msg.TopicArn = 'arn:aws:sns:eu-central-1:1:wrong-topic';
    await expect(sut.handle('Notification', msg as any)).rejects.toThrow(ForbiddenException);
    expect(suppressions.suppress).not.toHaveBeenCalled();
  });

  test('bad SNS signature → 403, never touches suppression list', async () => {
    const { sut, suppressions } = makeSut({ signatureOk: false });
    await expect(sut.handle('Notification', makeBounceMessage('x@b.com') as any)).rejects.toThrow(ForbiddenException);
    expect(suppressions.suppress).not.toHaveBeenCalled();
  });
});

describe('SesEventsController.handle — bounce + complaint processing', () => {
  test('permanent bounce → suppress() called once with bounce reason', async () => {
    const { sut, suppressions } = makeSut();
    await sut.handle('Notification', makeBounceMessage('hard@bounced.com', 'Permanent') as any);
    expect(suppressions.suppress).toHaveBeenCalledTimes(1);
    const [email, reason, sub] = suppressions.suppress.mock.calls[0];
    expect(email).toBe('hard@bounced.com');
    expect(reason).toBe('bounce');
    expect(sub).toMatch(/^Permanent\//);
  });

  test('transient bounce → suppression NOT called (mailbox full / greylisting auto-recovers)', async () => {
    const { sut, suppressions } = makeSut();
    await sut.handle('Notification', makeBounceMessage('soft@bounced.com', 'Transient') as any);
    expect(suppressions.suppress).not.toHaveBeenCalled();
  });

  test('complaint → suppress() with reason=complaint regardless of feedbackType', async () => {
    const { sut, suppressions } = makeSut();
    await sut.handle('Notification', makeComplaintMessage('marked@spam.com') as any);
    expect(suppressions.suppress).toHaveBeenCalledTimes(1);
    expect(suppressions.suppress.mock.calls[0][1]).toBe('complaint');
  });

  test('multiple bounced recipients in one message → all suppressed', async () => {
    const { sut, suppressions } = makeSut();
    const msg = makeBounceMessage('a@b.com');
    const inner = JSON.parse(msg.Message);
    inner.bounce.bouncedRecipients = [
      { emailAddress: 'a@b.com' },
      { emailAddress: 'b@c.com' },
      { emailAddress: 'c@d.com' },
    ];
    msg.Message = JSON.stringify(inner);
    await sut.handle('Notification', msg as any);
    expect(suppressions.suppress).toHaveBeenCalledTimes(3);
  });

  test('malformed Message JSON → returns ok without suppression (don\'t loop SNS retries)', async () => {
    const { sut, suppressions } = makeSut();
    const msg: any = makeBounceMessage('a@b.com');
    msg.Message = 'not-json';
    const result = await sut.handle('Notification', msg);
    expect(result).toEqual({ ok: true });
    expect(suppressions.suppress).not.toHaveBeenCalled();
  });
});

describe('SesEventsController.handle — subscription handshake', () => {
  test('SubscriptionConfirmation → fetches SubscribeURL, returns ok', async () => {
    const { sut } = makeSut();
    fetchMock.mockClear();
    const msg = {
      Type: 'SubscriptionConfirmation',
      MessageId: 'msg-3',
      TopicArn: KNOWN_BOUNCES_ARN,
      Timestamp: '2026-05-03T10:00:00Z',
      SignatureVersion: '1',
      Signature: 'sig',
      SigningCertURL: 'https://sns.eu-central-1.amazonaws.com/cert.pem',
      SubscribeURL: 'https://sns.eu-central-1.amazonaws.com/?Action=ConfirmSubscription&Token=xxx',
      Message: 'You have chosen to subscribe...',
    };
    const result = await sut.handle('SubscriptionConfirmation', msg as any);
    expect(fetchMock).toHaveBeenCalledWith('https://sns.eu-central-1.amazonaws.com/?Action=ConfirmSubscription&Token=xxx');
    expect(result).toEqual({ ok: true });
  });

  test('SubscriptionConfirmation without SubscribeURL → 403', async () => {
    const { sut } = makeSut();
    const msg = {
      Type: 'SubscriptionConfirmation',
      MessageId: 'msg-3',
      TopicArn: KNOWN_BOUNCES_ARN,
      Timestamp: '2026-05-03T10:00:00Z',
      SignatureVersion: '1',
      Signature: 'sig',
      SigningCertURL: 'https://sns.../cert.pem',
      Message: 'You have chosen to subscribe...',
    } as any;
    await expect(sut.handle('SubscriptionConfirmation', msg)).rejects.toThrow(ForbiddenException);
  });

  // ── SSRF defence on SubscribeURL ────────────────────────────────────
  test.each([
    ['http://sns.eu-central-1.amazonaws.com/?Action=ConfirmSubscription', 'http (not https)'],
    ['https://169.254.169.254/latest/meta-data/iam/security-credentials/', 'IMDS endpoint'],
    ['https://attacker.example/relay?url=...', 'attacker domain'],
    ['https://sns.amazonaws.com.attacker.test/', 'attacker subdomain trick'],
    ['https://sns-fake.eu-central-1.amazonaws.com/', 'wrong subdomain prefix'],
    ['https://localhost/admin', 'localhost'],
    ['file:///etc/passwd', 'file:// scheme'],
  ])('SubscribeURL %p (%s) → 403 (SSRF defence)', async (subscribeUrl) => {
    fetchMock.mockClear();
    const { sut } = makeSut();
    const msg = {
      Type: 'SubscriptionConfirmation',
      MessageId: 'msg-ssrf',
      TopicArn: KNOWN_BOUNCES_ARN,
      Timestamp: '2026-05-03T10:00:00Z',
      SignatureVersion: '1',
      Signature: 'sig',
      SigningCertURL: 'https://sns.eu-central-1.amazonaws.com/cert.pem',
      SubscribeURL: subscribeUrl,
      Message: 'You have chosen to subscribe...',
    } as any;
    await expect(sut.handle('SubscriptionConfirmation', msg)).rejects.toThrow(ForbiddenException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test.each([
    'https://sns.eu-central-1.amazonaws.com/?Action=ConfirmSubscription&Token=xxx',
    'https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&Token=yyy',
    'https://sns.cn-north-1.amazonaws.com.cn/?Action=ConfirmSubscription&Token=zzz', // China partition
  ])('legitimate AWS SNS SubscribeURL %p → fetch called', async (subscribeUrl) => {
    fetchMock.mockClear();
    const { sut } = makeSut();
    const msg = {
      Type: 'SubscriptionConfirmation',
      MessageId: 'msg-ok',
      TopicArn: KNOWN_BOUNCES_ARN,
      Timestamp: '2026-05-03T10:00:00Z',
      SignatureVersion: '1',
      Signature: 'sig',
      SigningCertURL: 'https://sns.eu-central-1.amazonaws.com/cert.pem',
      SubscribeURL: subscribeUrl,
      Message: 'You have chosen to subscribe...',
    } as any;
    const result = await sut.handle('SubscriptionConfirmation', msg);
    expect(fetchMock).toHaveBeenCalledWith(subscribeUrl);
    expect(result).toEqual({ ok: true });
  });
});
