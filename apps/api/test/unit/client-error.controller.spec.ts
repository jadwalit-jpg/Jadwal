/**
 * ClientErrorController regression tests.
 *
 * The CRITICAL contract pinned here: `logger.error` MUST be called with an
 * OBJECT containing `event: 'CLIENT_ERROR'` at top-level — NOT a stringified
 * JSON. The CloudWatch metric filter on `/ecs/jadwal-api` matches the
 * substring `"event":"CLIENT_ERROR"` and feeds the `Jadwal/Web
 * ClientErrorCount` metric. If a future refactor re-introduces
 * `logger.error(JSON.stringify({...}))`, pino escapes the JSON inside
 * `msg` (`"\\"event\\":\\"CLIENT_ERROR\\""`) and the filter silently
 * flatlines. This test detects that regression at PR-time.
 */

import { ClientErrorController } from '../../src/common/controllers/client-error.controller';

describe('ClientErrorController — CloudWatch filter compat', () => {
  let controller: ClientErrorController;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    controller = new ClientErrorController();
    // The Logger is created in the constructor via private field; reach
    // into it for the spy. Mirrors the pattern used elsewhere in the suite.
    errorSpy = jest
      .spyOn((controller as unknown as { logger: { error: jest.Mock } }).logger, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  const baseBody = {
    message: 'TypeError: undefined is not a function',
    url: 'https://jadwal.qa/activity/foo?token=secret',
    userAgent: 'Mozilla/5.0',
    userId: 'user-123',
    stack: 'at Component (Component.tsx:42:1)',
    componentStack: 'in ErrorBoundary',
  };

  const reqMock = {
    headers: {},
    ip: '203.0.113.5',
  } as unknown as Parameters<typeof controller.logClientError>[1];

  test('logger.error called with OBJECT (not string) so pino emits event at top-level', async () => {
    await controller.logClientError(baseBody, reqMock);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const arg = errorSpy.mock.calls[0][0];
    // Hard contract — the metric filter `"event":"CLIENT_ERROR"` only
    // matches when `event` is a top-level JSON field, which only happens
    // when the logger receives the OBJECT directly (pino's object-arg
    // form). String args end up nested inside `msg` and escape the quotes.
    expect(typeof arg).toBe('object');
    expect(arg).not.toBeNull();
    expect((arg as { event?: string }).event).toBe('CLIENT_ERROR');
  });

  test('regression: never call logger.error with a stringified payload', async () => {
    await controller.logClientError(baseBody, reqMock);
    const arg = errorSpy.mock.calls[0][0];
    // Strict regression guard — a string arg would mean someone re-wrapped
    // the payload in JSON.stringify and silently broke the CloudWatch
    // metric filter. This is the exact bug the comment in
    // client-error.controller.ts warns against.
    expect(typeof arg).not.toBe('string');
  });

  test('URL query string is stripped to prevent token leakage', async () => {
    await controller.logClientError(baseBody, reqMock);
    const arg = errorSpy.mock.calls[0][0] as { url?: string };
    expect(arg.url).toBe('https://jadwal.qa/activity/foo');
    expect(arg.url).not.toContain('token=');
  });

  test('cf-connecting-ip beats req.ip when present', async () => {
    const reqWithCf = {
      headers: { 'cf-connecting-ip': '198.51.100.10' },
      ip: '10.0.0.1',
    } as unknown as Parameters<typeof controller.logClientError>[1];
    await controller.logClientError(baseBody, reqWithCf);
    const arg = errorSpy.mock.calls[0][0] as { ip?: string };
    expect(arg.ip).toBe('198.51.100.10');
  });
});
