export const NEXT_PUBLIC_PRIVY_APP_ID: string = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? '';

export const NEXT_PUBLIC_AGENTS_URL: string =
  process.env.NEXT_PUBLIC_AGENTS_URL ?? 'http://localhost:4100';

export type ServerEnv = {
  privyAppId: string;
  privyAppSecret: string;
  leashApiUrl: string;
  leashApiAdminSecret: string;
  leashDbUrl: string;
  leashDbAuthToken: string | undefined;
  adminPrivyIds: string[];
};

export function getServerEnv(): ServerEnv {
  const get = (n: string): string => {
    const v = process.env[n];
    if (!v || v.length === 0) throw new Error(`missing env: ${n}`);
    return v;
  };
  const admins = (process.env.LEASH_ADMIN_PRIVY_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return {
    privyAppId: get('PRIVY_APP_ID'),
    privyAppSecret: get('PRIVY_APP_SECRET'),
    leashApiUrl: get('LEASH_API_URL').replace(/\/+$/, ''),
    leashApiAdminSecret: get('LEASH_API_ADMIN_SECRET'),
    leashDbUrl: get('LEASH_DB_URL'),
    leashDbAuthToken: process.env.LEASH_DB_AUTH_TOKEN,
    adminPrivyIds: admins,
  };
}

export function isAdminPrivyId(privyId: string): boolean {
  const ids = (process.env.LEASH_ADMIN_PRIVY_IDS ?? '').split(',').map((s) => s.trim());
  return ids.includes(privyId);
}
