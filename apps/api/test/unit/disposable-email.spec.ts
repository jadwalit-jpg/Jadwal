/**
 * @IsNotDisposableEmail() decorator tests.
 *
 * Validates the constraint by exercising it through class-validator's
 * `validate()` API on a fixture DTO — same path the global ValidationPipe
 * uses at runtime, so test passes prove production behaviour.
 */

import { validate } from 'class-validator';
import { IsNotDisposableEmail } from '../../src/common/validators/disposable-email';

class TestDto {
  @IsNotDisposableEmail()
  email!: string;
}

async function check(email: string): Promise<{ valid: boolean; messages: string[] }> {
  const dto = new TestDto();
  dto.email = email;
  const errors = await validate(dto);
  return {
    valid: errors.length === 0,
    messages: errors.flatMap((e) => Object.values(e.constraints ?? {})),
  };
}

describe('@IsNotDisposableEmail — blocklist behaviour', () => {
  test('rejects mailinator.com (canonical disposable domain)', async () => {
    const r = await check('user@mailinator.com');
    expect(r.valid).toBe(false);
    expect(r.messages.join(' ')).toMatch(/permanent email/i);
  });

  test('rejects tempmail-style domains (verify list breadth)', async () => {
    // 10minutemail.com is on the disposable-email-domains list; if the
    // package ever drops it the test catches that as a regression.
    const r = await check('user@10minutemail.com');
    expect(r.valid).toBe(false);
  });

  test('accepts gmail.com (the most common legit domain)', async () => {
    const r = await check('user@gmail.com');
    expect(r.valid).toBe(true);
  });

  test('accepts the project domain jadwal.qa', async () => {
    const r = await check('vendor@jadwal.qa');
    expect(r.valid).toBe(true);
  });

  test('case + whitespace insensitive (trims, lowercases before lookup)', async () => {
    const r = await check('  USER@MAILINATOR.com  ');
    expect(r.valid).toBe(false);
  });
});

describe('@IsNotDisposableEmail — degenerate inputs', () => {
  test('non-string value → invalid (returns false from validator)', async () => {
    const dto: any = new TestDto();
    dto.email = 12345;
    const errors = await validate(dto);
    // class-validator may run other constraints too; we just need at least
    // one error to fire on a non-string.
    expect(errors.length).toBeGreaterThan(0);
  });

  test('email without @ → rejected (no domain to check)', async () => {
    const r = await check('not-an-email');
    expect(r.valid).toBe(false);
  });

  test('empty string → rejected', async () => {
    const r = await check('');
    expect(r.valid).toBe(false);
  });

  test('email with @ as last char (no domain part) → rejected', async () => {
    const r = await check('user@');
    expect(r.valid).toBe(false);
  });
});

describe('@IsNotDisposableEmail — EMAIL_DOMAIN_ALLOWLIST escape hatch', () => {
  // The allowlist is read once at first use and cached for the process
  // lifetime. To exercise it we run these tests in their own jest module
  // process by isolating the cache via jest.isolateModules.
  test('allowlisted domain bypasses the blocklist', async () => {
    const previousEnv = process.env.EMAIL_DOMAIN_ALLOWLIST;
    process.env.EMAIL_DOMAIN_ALLOWLIST = 'mailinator.com,otherdomain.test';
    try {
      // jest.isolateModulesAsync (Jest 29.4+) is the async equivalent of
      // isolateModules — required here because our callback awaits
      // class-validator's validate(). The sync version doesn't await
      // and would let assertions run after the test exits, masking
      // failures.
      await jest.isolateModulesAsync(async () => {
        const mod = require('../../src/common/validators/disposable-email');
        const Decorator = mod.IsNotDisposableEmail;
        class LocalDto { email!: string; }
        Decorator()(LocalDto.prototype, 'email');
        const dto = new LocalDto();
        dto.email = 'user@mailinator.com';
        const errors = await validate(dto);
        expect(errors).toEqual([]); // allowlist override wins
      });
    } finally {
      if (previousEnv === undefined) delete process.env.EMAIL_DOMAIN_ALLOWLIST;
      else process.env.EMAIL_DOMAIN_ALLOWLIST = previousEnv;
    }
  });
});
