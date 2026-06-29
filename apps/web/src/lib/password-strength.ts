/**
 * Client-side password strength check — mirrors the server's `@IsStrongPassword`
 * (apps/api/src/common/validators/password-strength.ts) EXACTLY:
 *   - same zxcvbn library + version (4.4.2),
 *   - same MIN_SCORE (3),
 *   - same `userInputs` construction (email / fullName / phone + the domain
 *     words jadwal/qatar/doha, split on [\s@.+\-_]+, kept when length >= 3).
 *
 * Matching the server means a password the client accepts is never rejected by
 * the server with an opaque 400 — the bug this fixes (the prod ValidationPipe
 * runs with `disableErrorMessages`, so a server-side strength failure surfaced
 * to the user only as "Bad Request").
 *
 * zxcvbn is ~400KB, so it is DYNAMICALLY imported — it never lands in the
 * initial bundle, only when a password field is actually used.
 */

export const PASSWORD_MIN_SCORE = 3; // 0..4 zxcvbn scale; 3 = "safely unguessable"

export interface PasswordStrength {
  /** zxcvbn 0..4 score. */
  score: 0 | 1 | 2 | 3 | 4;
  /** score >= PASSWORD_MIN_SCORE — i.e. the server will accept it. */
  ok: boolean;
  /** zxcvbn's primary warning, e.g. "This is a top-10 common password". */
  warning: string;
  /** zxcvbn's actionable suggestions, e.g. "Add another word or two". */
  suggestions: string[];
}

// Mirror of the server's userInputs builder — keep in lockstep with
// IsStrongPasswordConstraint.validate(). Penalises passwords built from the
// user's own identity (e.g. "Yasmina2026") or obvious brand/geo words.
function buildUserInputs(identityParts: Array<string | undefined | null>): string[] {
  return [...identityParts, 'jadwal', 'qatar', 'doha']
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .flatMap((v) => v.split(/[\s@.+\-_]+/))
    .filter((v) => v.length >= 3);
}

type ZxcvbnFn = (
  password: string,
  userInputs?: string[],
) => { score: number; feedback: { warning: string; suggestions: string[] } };

// Cache the dynamic import so zxcvbn is fetched + parsed at most once.
let zxcvbnPromise: Promise<ZxcvbnFn> | null = null;
function loadZxcvbn(): Promise<ZxcvbnFn> {
  if (!zxcvbnPromise) {
    zxcvbnPromise = import('zxcvbn').then(
      (mod) => ((mod as unknown as { default?: ZxcvbnFn }).default ?? (mod as unknown as ZxcvbnFn)),
    );
  }
  return zxcvbnPromise;
}

/**
 * Evaluate a password's strength against the same rules the server enforces.
 * `identityParts` should carry the same fields the server uses (email, full
 * name, phone) so the personal-info penalty matches.
 */
export async function evaluatePassword(
  password: string,
  identityParts: Array<string | undefined | null> = [],
): Promise<PasswordStrength> {
  const zxcvbn = await loadZxcvbn();
  const result = zxcvbn(password, buildUserInputs(identityParts));
  const score = Math.max(0, Math.min(4, result.score)) as 0 | 1 | 2 | 3 | 4;
  return {
    score,
    ok: score >= PASSWORD_MIN_SCORE,
    warning: result.feedback?.warning ?? '',
    suggestions: result.feedback?.suggestions ?? [],
  };
}
