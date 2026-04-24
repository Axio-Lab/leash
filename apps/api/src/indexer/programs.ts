/**
 * Program IDs the indexer recognises when classifying transactions.
 *
 * These are pinned to the on-chain program addresses Metaplex publishes
 * for `mpl-agent-identity`, `mpl-agent-tools`, and `mpl-core`. They are
 * the same on devnet and mainnet (Metaplex deploys the same program
 * across both clusters), so we hard-code them here rather than reading
 * via Umi at runtime — the indexer's only RPC dependency is signature +
 * transaction lookup, which doesn't need a Umi instance.
 */

export const MPL_AGENT_IDENTITY_PROGRAM_ID = '1DREGFgysWYxLnRnKQnwrxnJQeSMk2HmGaC6whw2B2p';
export const MPL_AGENT_TOOLS_PROGRAM_ID = 'TLREGni9ZEyGC3vnPZtqUh95xQ8oPqJSvNjvB7FGK8S';
export const MPL_CORE_PROGRAM_ID = 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d';
export const SPL_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';

export const KNOWN_PROGRAMS = {
  identity: MPL_AGENT_IDENTITY_PROGRAM_ID,
  tools: MPL_AGENT_TOOLS_PROGRAM_ID,
  core: MPL_CORE_PROGRAM_ID,
  splToken: SPL_TOKEN_PROGRAM_ID,
  token2022: TOKEN_2022_PROGRAM_ID,
  system: SYSTEM_PROGRAM_ID,
} as const;
