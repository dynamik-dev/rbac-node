import { describe, expect, it } from 'vitest';

import { DEFAULT_WILDCARD_CONFIG, matchesWildcard } from './wildcard.js';

describe('matchesWildcard', () => {
  it('exact match', () => {
    expect(matchesWildcard('articles.edit', 'articles.edit')).toBe(true);
    expect(matchesWildcard('articles.edit', 'articles.create')).toBe(false);
  });

  it('single-segment wildcard', () => {
    expect(matchesWildcard('articles.*', 'articles.edit')).toBe(true);
    expect(matchesWildcard('articles.*', 'articles.create')).toBe(true);
    expect(matchesWildcard('articles.*', 'users.create')).toBe(false);
    // Stored is more specific than requested -> no match.
    expect(matchesWildcard('articles.*', 'articles.edit.draft')).toBe(false);
  });

  it('leading wildcard', () => {
    expect(matchesWildcard('*.delete', 'articles.delete')).toBe(true);
    expect(matchesWildcard('*.delete', 'users.delete')).toBe(true);
    expect(matchesWildcard('*.delete', 'articles.create')).toBe(false);
  });

  it('multi-level segments', () => {
    expect(matchesWildcard('users.posts.*', 'users.posts.edit')).toBe(true);
    expect(matchesWildcard('users.*.edit', 'users.posts.edit')).toBe(true);
    expect(matchesWildcard('users.*.edit', 'users.posts.create')).toBe(false);
  });

  it('deep wildcard `**` matches any tail', () => {
    expect(matchesWildcard('articles.**', 'articles.edit')).toBe(true);
    expect(matchesWildcard('articles.**', 'articles.posts.edit')).toBe(true);
    expect(matchesWildcard('articles.**', 'articles')).toBe(false);
    expect(matchesWildcard('articles.**', 'users.edit')).toBe(false);
  });

  it('configurable separator', () => {
    const cfg = { enabled: true, separator: ':' };
    expect(matchesWildcard('articles:*', 'articles:edit', cfg)).toBe(true);
    expect(matchesWildcard('articles:*', 'articles.edit', cfg)).toBe(false);
  });

  it('disabled config collapses to strict equality', () => {
    const cfg = { enabled: false, separator: '.' };
    expect(matchesWildcard('articles.*', 'articles.edit', cfg)).toBe(false);
    expect(matchesWildcard('articles.edit', 'articles.edit', cfg)).toBe(true);
  });

  it('default config is enabled', () => {
    expect(DEFAULT_WILDCARD_CONFIG.enabled).toBe(true);
    expect(DEFAULT_WILDCARD_CONFIG.separator).toBe('.');
  });
});
