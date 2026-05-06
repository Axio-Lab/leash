import { describe, expect, it } from 'vitest';
import {
  buildMppAuthorizationHeader,
  decodeMppCredential,
  encodeMppCredential,
  looksLikeMppChallenge,
  MPP_AUTH_SCHEME,
  MPP_PROBLEM_TYPE,
  mppChallengeHash,
  parseMppAuthorization,
  parseMppChallenge,
  parseMppChallengeBody,
} from '../src/mpp/index.js';

const challenge = {
  type: MPP_PROBLEM_TYPE,
  status: 402 as const,
  challengeId: 'ch-1',
  title: 'Payment Required',
  detail: 'pay to continue',
  request: {
    recipient: 'PayTo1111111111111111111111111111111111',
    amount: '1000',
    currency: 'USDC',
    network: 'solana-devnet',
    asset: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  },
};

describe('MPP parse', () => {
  it('looksLikeMppChallenge accepts well-shaped body', () => {
    expect(looksLikeMppChallenge(challenge)).toBe(true);
  });
  it('rejects non-MPP shape', () => {
    expect(looksLikeMppChallenge({ type: 'wrong', challengeId: 'x' })).toBe(false);
    expect(looksLikeMppChallenge({ type: MPP_PROBLEM_TYPE })).toBe(false);
    expect(looksLikeMppChallenge(null)).toBe(false);
  });
  it('parseMppChallengeBody validates strictly', () => {
    expect(() => parseMppChallengeBody(challenge)).not.toThrow();
    expect(() => parseMppChallengeBody({ ...challenge, status: 401 })).toThrow();
  });
  it('parseMppChallenge reads from a Response', async () => {
    const res = new Response(JSON.stringify(challenge), { status: 402 });
    const c = await parseMppChallenge(res);
    expect(c.challengeId).toBe('ch-1');
  });
});

describe('MPP credential headers', () => {
  const credential = {
    v: '1' as const,
    challengeId: 'ch-2',
    signedTx: 'AAAA',
  };

  it('round-trips encode/decode', () => {
    const encoded = encodeMppCredential(credential);
    const decoded = decodeMppCredential(encoded);
    expect(decoded).toEqual(credential);
  });

  it('builds and parses Authorization header', () => {
    const header = buildMppAuthorizationHeader(credential);
    expect(header.startsWith(`${MPP_AUTH_SCHEME} `)).toBe(true);
    const parsed = parseMppAuthorization(header);
    expect(parsed?.challengeId).toBe('ch-2');
  });

  it('parses bare base64 payload (no scheme prefix)', () => {
    const encoded = encodeMppCredential(credential);
    const parsed = parseMppAuthorization(encoded);
    expect(parsed?.challengeId).toBe('ch-2');
  });

  it('returns null on missing/empty header', () => {
    expect(parseMppAuthorization(null)).toBeNull();
    expect(parseMppAuthorization('')).toBeNull();
    expect(parseMppAuthorization('   ')).toBeNull();
  });

  it('rejects unknown credential versions', () => {
    const bad = encodeMppCredential({ ...credential, v: '99' as unknown as '1' });
    expect(() => decodeMppCredential(bad)).toThrow(/unsupported credential version/);
  });
});

describe('MPP envelope hashing', () => {
  it('mppChallengeHash is stable + content-addressed', () => {
    const a = mppChallengeHash(challenge);
    const b = mppChallengeHash({ ...challenge });
    expect(a).toBe(b);
    const c = mppChallengeHash({ ...challenge, challengeId: 'ch-different' });
    expect(c).not.toBe(a);
  });
});
