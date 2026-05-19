import { describe, expect, it } from 'vitest';

import { buildSellerIdentityMetadata } from '../src/identity.js';

describe('buildSellerIdentityMetadata', () => {
  it('emits versioned identity metadata for buyer preflight', () => {
    expect(
      buildSellerIdentityMetadata({
        agent_mint: 'SellerMint',
        handle: 'seller',
        domain: 'seller.example',
        capability_cards: [{ slug: 'seller/api', protocol: 'x402' }],
      }),
    ).toEqual({
      leash: {
        identity: {
          v: '0.1',
          agent_mint: 'SellerMint',
          handle: 'seller',
          domain: 'seller.example',
          capability_cards: [{ slug: 'seller/api', protocol: 'x402' }],
        },
      },
    });
  });
});
