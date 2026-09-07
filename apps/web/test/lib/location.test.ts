import { displayableAddress } from '@/lib/location';

/**
 * Guards the fix for the 2026-09-07 report that the explore page showed
 * "Public Al Safliya Island Water Sports / 25.2973927, 51.5500061" instead of
 * a place name. Every activity on that page was affected, not just the one.
 *
 * The risk in a regex like this is over-matching: suppressing a real address
 * that happens to contain numbers would silently hide genuine location info
 * from customers, which is a worse bug than the one being fixed. Most of the
 * cases below exist to pin that down.
 */
describe('displayableAddress', () => {
  describe('suppresses bare coordinate pairs', () => {
    it.each([
      ['25.2973927, 51.5500061', 'the exact value seen live on explore'],
      ['25.2972, 51.5506', 'the value on the other five cards'],
      ['25.2972,51.5506', 'no space after the comma'],
      ['25.2972 , 51.5506', 'spaces either side of the comma'],
      ['  25.2972, 51.5506  ', 'surrounding whitespace'],
      ['-33.8688, 151.2093', 'negative latitude'],
      ['25, 51', 'integer pair with no decimal part'],
    ])('%s (%s)', (input) => {
      expect(displayableAddress(input)).toBeNull();
    });
  });

  describe('keeps anything a human would read as a place', () => {
    it.each([
      ['Box Park', 'the city name this page should have shown'],
      ['Building 25, Street 51', 'starts with a word, so not a coordinate'],
      ['12, 34 Al Sadd Street', 'trailing text defeats the end anchor'],
      ['Villa 12, Zone 3, Doha', 'numbers inside a real address'],
      ['Gate 4, Lusail Marina', 'a genuine meeting point'],
      ['ميناء الدوحة القديم', 'Arabic address text'],
      ['25.2972', 'a lone number is not a pair — leave it alone'],
      ['1234.5, 51.5', 'four integer digits is out of latitude range'],
    ])('%s (%s)', (input) => {
      expect(displayableAddress(input)).toBe(input);
    });
  });

  describe('handles absent values', () => {
    it.each([
      ['null', null],
      ['undefined', undefined],
      ['empty string', ''],
    ])('%s becomes null', (_label, input) => {
      expect(displayableAddress(input)).toBeNull();
    });
  });
});
