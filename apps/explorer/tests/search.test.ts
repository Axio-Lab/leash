import { describe, expect, it } from 'vitest';
import { resolveSearch, searchHitToHref } from '../lib/search.js';

describe('resolveSearch', () => {
  it('routes a 64-char hex string to a receipt', () => {
    const hash = 'a'.repeat(64);
    expect(resolveSearch(hash)).toEqual({ kind: 'receipt', value: hash });
    expect(searchHitToHref(resolveSearch(hash))).toBe(`/receipt/${hash}`);
  });

  it('routes ULID-shaped input to an event', () => {
    const id = '01HVTQX4GZTH8XK1F2JZ7N5WJ4';
    const hit = resolveSearch(id);
    expect(hit.kind).toBe('event');
    expect(hit.value).toBe(id);
  });

  it('routes a 32-44 char base58 string to an agent', () => {
    const pubkey = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    expect(resolveSearch(pubkey)).toEqual({ kind: 'agent', value: pubkey });
  });

  it('routes a long base58 string to a transaction', () => {
    const sig = '5'.repeat(88);
    const hit = resolveSearch(sig);
    expect(hit.kind).toBe('tx');
    expect(hit.value).toBe(sig);
  });

  it('falls back to /search for unknown shapes', () => {
    const hit = resolveSearch('hello world');
    expect(hit.kind).toBe('unknown');
    expect(searchHitToHref(hit)).toBe('/search?q=hello%20world');
  });

  it('returns unknown for empty input', () => {
    const hit = resolveSearch('');
    expect(hit).toEqual({ kind: 'unknown', value: '' });
  });
});
