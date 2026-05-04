export const HIDDEN_YOUTUBE_SEARCHES_STORAGE_KEY = 'musfy-hidden-youtube-searches-v1';

export interface YoutubeRecentSearchEntry {
  query: string;
}

export function getRecentSearchKey(query?: string | null) {
  return String(query || '').trim().toLowerCase();
}

export function parseHiddenRecentSearches(rawValue: string | null): string[] {
  if (!rawValue) return [];

  try {
    const parsed = JSON.parse(rawValue);
    return Array.isArray(parsed) ? parsed.map((entry) => getRecentSearchKey(entry)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function hideRecentSearch(current: string[], query: string) {
  const key = getRecentSearchKey(query);
  if (!key || current.includes(key)) return current;
  return [...current, key];
}

export function filterVisibleRecentSearches<T extends YoutubeRecentSearchEntry>(entries: T[], hiddenSearches: string[]) {
  const hidden = new Set(hiddenSearches.map((entry) => getRecentSearchKey(entry)).filter(Boolean));
  return entries.filter((entry) => !hidden.has(getRecentSearchKey(entry.query)));
}
