import { describe, expect, it } from 'vitest';
import { isNewer, parseVersion } from './updates';

describe('Versionsprüfung', () => {
  it('liest Versionen mit und ohne „v“', () => {
    expect(parseVersion('v0.10.0')).toEqual([0, 10, 0]);
    expect(parseVersion('1.2.3')).toEqual([1, 2, 3]);
    expect(parseVersion('dev')).toBeNull();
    expect(parseVersion('1.2')).toBeNull();
  });

  it('vergleicht numerisch, nicht als Text', () => {
    expect(isNewer('v0.10.0', '0.9.3')).toBe(true);
    expect(isNewer('0.9.3', '0.10.0')).toBe(false);
    expect(isNewer('1.0.0', '0.99.99')).toBe(true);
    expect(isNewer('0.9.4', '0.9.3')).toBe(true);
  });

  it('gleiche oder unlesbare Versionen gelten nicht als neuer', () => {
    expect(isNewer('v0.9.3', '0.9.3')).toBe(false);
    expect(isNewer('nightly', '0.9.3')).toBe(false);
    expect(isNewer('0.9.4', 'dev')).toBe(false);
  });
});
