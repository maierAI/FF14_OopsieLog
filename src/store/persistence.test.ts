import { describe, expect, it } from 'vitest';
import { resolveRemoteStorageValue } from './persistence';

describe('resolveRemoteStorageValue', () => {
  it('falls back to local cache when the server has not stored the workspace yet', () => {
    const localSnapshot = '{"state":{"teams":[{"id":"team-1"}]}}';

    expect(resolveRemoteStorageValue(null, localSnapshot)).toBe(localSnapshot);
  });

  it('preserves falsey values returned by the server', () => {
    expect(resolveRemoteStorageValue(false, null)).toBe('false');
    expect(resolveRemoteStorageValue(0, null)).toBe('0');
    expect(resolveRemoteStorageValue('', null)).toBe('""');
  });
});
