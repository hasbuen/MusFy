import { describe, expect, it } from 'vitest';
import {
  filterVisibleRecentSearches,
  getRecentSearchKey,
  hideRecentSearch,
  parseHiddenRecentSearches
} from './youtubeRecentSearches';

describe('youtubeRecentSearches', () => {
  it('normalizes recent search keys so duplicated casing and spaces collapse', () => {
    expect(getRecentSearchKey('  Eminem  ')).toBe('eminem');
    expect(getRecentSearchKey(null)).toBe('');
  });

  it('parses persisted hidden searches defensively', () => {
    expect(parseHiddenRecentSearches('[" BK ","Eminem",""]')).toEqual(['bk', 'eminem']);
    expect(parseHiddenRecentSearches('{bad json')).toEqual([]);
    expect(parseHiddenRecentSearches('{"query":"bk"}')).toEqual([]);
  });

  it('hides a badge once without mutating the current list', () => {
    const current = ['eminem'];
    const next = hideRecentSearch(current, ' BK ');

    expect(next).toEqual(['eminem', 'bk']);
    expect(current).toEqual(['eminem']);
    expect(hideRecentSearch(next, 'bk')).toBe(next);
  });

  it('filters only individually removed badges and keeps the rest visible', () => {
    const entries = [
      { query: 'creedence' },
      { query: 'eminem' },
      { query: 'new model army' },
      { query: 'bk' }
    ];

    expect(filterVisibleRecentSearches(entries, [' EMINEM ', 'bk'])).toEqual([
      { query: 'creedence' },
      { query: 'new model army' }
    ]);
  });
});
