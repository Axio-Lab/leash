/**
 * Storage helpers for the marketplace `listings` table (schema v9) and
 * its companion `listing_ratings` + `listing_reviews` tables.
 *
 * The marketplace (`leash.market`) is an open registry of MCP servers
 * that agents can discover and pay per call. Pricing + tools are JSON
 * blobs; admin approval gates are encoded via the `status` column.
 */

import { ulid } from 'ulid';

import type { DbClient } from './turso.js';
import { execute } from './turso.js';

export type ListingPricing = {
  type: 'free' | 'per_call' | 'variable';
  amount?: string;
  currency?: string;
};

export type ListingTool = {
  name: string;
  description: string;
  inputSchema?: unknown;
};

export type ListingStatus = 'pending' | 'approved' | 'rejected' | 'disabled';

export type ListingHealthStatus = 'ok' | 'warn' | 'down' | null;

export type Listing = {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  ownerPrivyId: string;
  ownerWallet: string;
  sellerAgentMint: string | null;
  endpoint: string;
  pricing: ListingPricing;
  tools: ListingTool[];
  docsUrl: string | null;
  freeTier: number;
  healthStatus: ListingHealthStatus;
  healthCheckedAt: string | null;
  status: ListingStatus;
  createdAt: string;
};

function rowToListing(row: Record<string, unknown>): Listing {
  let pricing: ListingPricing = { type: 'free' };
  try {
    const parsed = JSON.parse(String(row.pricing ?? '{}'));
    if (parsed && typeof parsed === 'object') pricing = parsed as ListingPricing;
  } catch {
    pricing = { type: 'free' };
  }
  let tools: ListingTool[] = [];
  try {
    const parsed = JSON.parse(String(row.tools ?? '[]'));
    if (Array.isArray(parsed)) tools = parsed as ListingTool[];
  } catch {
    tools = [];
  }
  const status = String(row.status);
  if (
    status !== 'pending' &&
    status !== 'approved' &&
    status !== 'rejected' &&
    status !== 'disabled'
  ) {
    throw new Error(`unexpected listing status: ${status}`);
  }
  const healthRaw = row.health_status != null ? String(row.health_status) : null;
  const healthStatus: ListingHealthStatus =
    healthRaw === 'ok' || healthRaw === 'warn' || healthRaw === 'down' ? healthRaw : null;
  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    description: String(row.description),
    category: String(row.category),
    ownerPrivyId: String(row.owner_privy_id),
    ownerWallet: String(row.owner_wallet),
    sellerAgentMint: row.seller_agent_mint == null ? null : String(row.seller_agent_mint),
    endpoint: String(row.endpoint),
    pricing,
    tools,
    docsUrl: row.docs_url != null ? String(row.docs_url) : null,
    freeTier: Number(row.free_tier ?? 0),
    healthStatus,
    healthCheckedAt: row.health_checked != null ? String(row.health_checked) : null,
    status,
    createdAt: String(row.created_at),
  };
}

export async function createListing(
  db: DbClient,
  args: {
    slug: string;
    name: string;
    description: string;
    category: string;
    ownerPrivyId: string;
    ownerWallet: string;
    sellerAgentMint?: string | null;
    endpoint: string;
    pricing: ListingPricing;
    tools: ListingTool[];
    docsUrl?: string;
    freeTier?: number;
  },
): Promise<Listing> {
  const id = ulid();
  await execute(
    db,
    `INSERT INTO listings (
      id, slug, name, description, category,
      owner_privy_id, owner_wallet, seller_agent_mint, endpoint,
      pricing, tools, docs_url, free_tier
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      args.slug,
      args.name,
      args.description,
      args.category,
      args.ownerPrivyId,
      args.ownerWallet,
      args.sellerAgentMint ?? null,
      args.endpoint,
      JSON.stringify(args.pricing),
      JSON.stringify(args.tools),
      args.docsUrl ?? null,
      args.freeTier ?? 0,
    ],
  );
  const created = await getListingById(db, id);
  if (!created) throw new Error('listing insert succeeded but lookup failed');
  return created;
}

export async function getListingBySlug(db: DbClient, slug: string): Promise<Listing | null> {
  const r = await execute(db, 'SELECT * FROM listings WHERE slug = ? LIMIT 1', [slug]);
  const row = r.rows[0];
  return row ? rowToListing(row as Record<string, unknown>) : null;
}

export async function getListingById(db: DbClient, id: string): Promise<Listing | null> {
  const r = await execute(db, 'SELECT * FROM listings WHERE id = ? LIMIT 1', [id]);
  const row = r.rows[0];
  return row ? rowToListing(row as Record<string, unknown>) : null;
}

export type ListListingsArgs = {
  /** One status, or several (seller "my listings" uses `IN`). */
  status?: ListingStatus | ListingStatus[];
  category?: string;
  ownerPrivyId?: string;
  q?: string;
  limit?: number;
};

export async function listListings(db: DbClient, args: ListListingsArgs = {}): Promise<Listing[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (args.status !== undefined) {
    const sts = Array.isArray(args.status) ? args.status : [args.status];
    if (sts.length === 1) {
      where.push('status = ?');
      params.push(sts[0]);
    } else {
      where.push(`status IN (${sts.map(() => '?').join(',')})`);
      params.push(...sts);
    }
  }
  if (args.category) {
    where.push('category = ?');
    params.push(args.category);
  }
  if (args.ownerPrivyId) {
    where.push('owner_privy_id = ?');
    params.push(args.ownerPrivyId);
  }
  if (args.q && args.q.trim().length > 0) {
    where.push('(name LIKE ? OR description LIKE ? OR slug LIKE ?)');
    const like = `%${args.q.trim()}%`;
    params.push(like, like, like);
  }
  const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
  params.push(limit);
  const sql = `SELECT * FROM listings ${
    where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
  } ORDER BY created_at DESC LIMIT ?`;
  const r = await execute(db, sql, params as never[]);
  return r.rows.map((row) => rowToListing(row as Record<string, unknown>));
}

export async function setListingStatus(
  db: DbClient,
  id: string,
  status: ListingStatus,
): Promise<void> {
  await execute(db, 'UPDATE listings SET status = ? WHERE id = ?', [status, id]);
}

export async function recordListingHealth(
  db: DbClient,
  id: string,
  status: 'ok' | 'warn' | 'down',
): Promise<void> {
  await execute(
    db,
    `UPDATE listings SET health_status = ?, health_checked = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
    [status, id],
  );
}

// ─── ratings + reviews ───────────────────────────────────────────────

export async function setListingRating(
  db: DbClient,
  args: { listingId: string; privyId: string; stars: number },
): Promise<void> {
  if (!Number.isInteger(args.stars) || args.stars < 1 || args.stars > 5) {
    throw new Error('stars must be an integer between 1 and 5');
  }
  await execute(
    db,
    `INSERT INTO listing_ratings (listing_id, privy_id, stars)
       VALUES (?, ?, ?)
       ON CONFLICT (listing_id, privy_id) DO UPDATE SET stars = excluded.stars`,
    [args.listingId, args.privyId, args.stars],
  );
}

export type ListingRatingSummary = { avg: number; count: number };

export async function getListingRatingSummary(
  db: DbClient,
  listingId: string,
): Promise<ListingRatingSummary> {
  const r = await execute(
    db,
    `SELECT AVG(stars) AS avg, COUNT(*) AS count FROM listing_ratings WHERE listing_id = ?`,
    [listingId],
  );
  const row = r.rows[0] as Record<string, unknown> | undefined;
  if (!row) return { avg: 0, count: 0 };
  const avg = row.avg != null ? Number(row.avg) : 0;
  const count = Number(row.count ?? 0);
  return { avg, count };
}

export type ListingReview = {
  id: string;
  listingId: string;
  privyId: string;
  body: string;
  createdAt: string;
};

export async function addListingReview(
  db: DbClient,
  args: { listingId: string; privyId: string; body: string },
): Promise<ListingReview> {
  const id = ulid();
  await execute(
    db,
    `INSERT INTO listing_reviews (id, listing_id, privy_id, body) VALUES (?, ?, ?, ?)`,
    [id, args.listingId, args.privyId, args.body],
  );
  const r = await execute(db, 'SELECT * FROM listing_reviews WHERE id = ?', [id]);
  const row = r.rows[0] as Record<string, unknown>;
  return {
    id: String(row.id),
    listingId: String(row.listing_id),
    privyId: String(row.privy_id),
    body: String(row.body),
    createdAt: String(row.created_at),
  };
}

export async function listListingReviews(
  db: DbClient,
  listingId: string,
  limit = 50,
): Promise<ListingReview[]> {
  const r = await execute(
    db,
    `SELECT * FROM listing_reviews WHERE listing_id = ? ORDER BY created_at DESC LIMIT ?`,
    [listingId, Math.min(Math.max(limit, 1), 200)],
  );
  return r.rows.map((row) => {
    const m = row as Record<string, unknown>;
    return {
      id: String(m.id),
      listingId: String(m.listing_id),
      privyId: String(m.privy_id),
      body: String(m.body),
      createdAt: String(m.created_at),
    };
  });
}
