/**
 * resolveLanguageFromRequest — Accept-Language → email language.
 * Seeds User.preferredLanguage at registration (Phase 4A).
 */
import { resolveLanguageFromRequest } from '../../src/common/utils/locale';

describe('resolveLanguageFromRequest', () => {
  const reqWith = (acceptLanguage?: string) =>
    ({ headers: acceptLanguage === undefined ? {} : { 'accept-language': acceptLanguage } } as any);

  test('Arabic primary tag → AR', () => {
    expect(resolveLanguageFromRequest(reqWith('ar-QA,ar;q=0.9,en;q=0.8'))).toBe('AR');
    expect(resolveLanguageFromRequest(reqWith('ar'))).toBe('AR');
    expect(resolveLanguageFromRequest(reqWith('AR-qa'))).toBe('AR');
  });

  test('English / other primary tag → EN', () => {
    expect(resolveLanguageFromRequest(reqWith('en-US,en;q=0.9'))).toBe('EN');
    expect(resolveLanguageFromRequest(reqWith('fr-FR,fr'))).toBe('EN');
    // Arabic only as a lower-priority tag does not flip the choice
    expect(resolveLanguageFromRequest(reqWith('en-US,ar;q=0.5'))).toBe('EN');
  });

  test('missing / empty / non-string header → EN (safe default)', () => {
    expect(resolveLanguageFromRequest(reqWith(undefined))).toBe('EN');
    expect(resolveLanguageFromRequest(reqWith(''))).toBe('EN');
    expect(resolveLanguageFromRequest(reqWith('   '))).toBe('EN');
    expect(resolveLanguageFromRequest(undefined)).toBe('EN');
    expect(resolveLanguageFromRequest(null)).toBe('EN');
    expect(resolveLanguageFromRequest({} as any)).toBe('EN');
  });
});
