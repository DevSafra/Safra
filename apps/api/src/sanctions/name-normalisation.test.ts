import { describe, expect, it } from 'vitest';

import { nameTokens, normaliseName, tokenOverlap } from './name-normalisation.js';

/**
 * The cases that decide whether screening works at all.
 *
 * A sanctions check fails in two directions and they are not symmetrical. A false
 * negative onboards a designated counterparty and is a legal exposure for the German
 * entity; a false positive annoys a legitimate partner for as long as it takes a
 * human to look. So these tests lean hard on the first: the spellings below MUST
 * converge, and where a rule is too eager that is recorded rather than hidden.
 */
describe('normaliseName', () => {
  /** The single most common name in any Levantine screening, spelled six ways. */
  it('converges the Muhammad family', () => {
    const spellings = [
      'Muhammad',
      'Mohammed',
      'Mohamed',
      'Mohammad',
      'Muhammed',
      'Mohamad',
    ];

    const normalised = new Set(spellings.map(normaliseName));

    expect(normalised).toStrictEqual(new Set(['muhammad']));
  });

  it('converges other common transliteration families', () => {
    expect(normaliseName('Ahmed')).toBe(normaliseName('Ahmad'));
    expect(normaliseName('Hussein')).toBe(normaliseName('Husayn'));
    expect(normaliseName('Hassan')).toBe(normaliseName('Hasan'));
    expect(normaliseName('Youssef')).toBe(normaliseName('Yusef'));
    expect(normaliseName('Ibraheem')).toBe(normaliseName('Ibrahim'));
    expect(normaliseName('Khaled')).toBe(normaliseName('Khalid'));
  });

  /** `Al-Assad`, `Al Assad`, `al assad` are one name written three ways. */
  it('drops the definite article however it is attached', () => {
    expect(normaliseName('Bashar al-Assad')).toBe(normaliseName('Bashar Al Assad'));
    expect(normaliseName('Bashar AL-ASSAD')).toBe(normaliseName('bashar al assad'));
  });

  it('strips diacritics and scholarly transliteration glyphs', () => {
    expect(normaliseName('Muḥammad al-ʾAsad')).toBe(normaliseName('Muhammad al-Asad'));
    expect(normaliseName('Ámr')).toBe(normaliseName('Amr'));
  });

  it('collapses punctuation and repeated whitespace', () => {
    expect(normaliseName('  Al-Sayyid,  Ahmad   ')).toBe(
      normaliseName('Al Sayyid Ahmad'),
    );
  });

  /**
   * Particles are removed as TOKENS only. Stripping them as substrings would maim
   * ordinary names — the reason the filter operates after tokenisation.
   */
  it('does not strip particles from inside a word', () => {
    expect(normaliseName('Salah')).toBe('salah');
    expect(normaliseName('Robin')).toBe('robin');
    expect(normaliseName('Alavi')).toBe('alavi');
  });

  /**
   * A name made only of particles must not reduce to nothing — an empty normalised
   * name matches nothing, and failing silent is the dangerous direction here.
   */
  it('keeps something when a name is all particles', () => {
    expect(normaliseName('Abu Bakr')).not.toBe('');
    expect(normaliseName('Abdul')).not.toBe('');
  });

  it('returns empty only when there was nothing to work with', () => {
    expect(normaliseName('')).toBe('');
    expect(normaliseName('   ')).toBe('');
    expect(normaliseName('...')).toBe('');
  });

  /** Entities, not just people — a company is designated the same way. */
  it('normalises organisation names', () => {
    expect(normaliseName('Syrian Arab Airlines')).toBe('syrian arab airlines');
    expect(normaliseName('THE Commercial Bank of Syria')).toBe('commercial bank syria');
  });

  /**
   * Distinct people must stay distinct. Over-eager folding is how a screening system
   * generates so many false positives that staff start dismissing them unread, which
   * is worse than no check at all.
   */
  it('keeps genuinely different names apart', () => {
    expect(normaliseName('Muhammad')).not.toBe(normaliseName('Mahmud'));
    expect(normaliseName('Hasan')).not.toBe(normaliseName('Husayn'));
    expect(normaliseName('Khalid')).not.toBe(normaliseName('Walid'));
    expect(normaliseName('Salim')).not.toBe(normaliseName('Salman'));
  });
});

describe('nameTokens', () => {
  it('splits a normalised name', () => {
    expect(nameTokens('Bashar al-Assad')).toStrictEqual(['bashar', 'asad']);
  });

  it('is empty for an empty name', () => {
    expect(nameTokens('  ')).toStrictEqual([]);
  });
});

describe('tokenOverlap', () => {
  it('is 1 when every token of the shorter name appears', () => {
    expect(tokenOverlap('Bashar al-Assad', 'Bashar Hafez al-Assad')).toBe(1);
  });

  it('is 0 for names sharing no parts', () => {
    expect(tokenOverlap('Bashar Assad', 'Layla Karim')).toBe(0);
  });

  /**
   * The case this exists for. Trigram similarity rates these highly on shared letter
   * runs; token overlap shows they have no name part in common, which is what lets
   * the matcher demote the hit instead of reporting it at full confidence.
   */
  it('is low for names that only look similar as letters', () => {
    expect(tokenOverlap('Hasan Ibrahim', 'Husayn Ibrahimi')).toBeLessThan(0.6);
  });

  it('is 0 when either side normalises to nothing', () => {
    expect(tokenOverlap('', 'Bashar')).toBe(0);
  });
});
