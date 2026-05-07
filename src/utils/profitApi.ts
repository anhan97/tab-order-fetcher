// PLSnapshot is a UNION of:
//   - DB snapshot rows (historical days, isFinalized=true) — fields arrive as
//     decimal strings from Prisma serialisation.
//   - LIVE today row computed on-the-fly — same field names, but numeric
//     amounts come back as numbers because they're freshly computed.
// The frontend handles both via parseFloat (no-op for numbers).
export interface PLSnapshot {
  id?: string;
  date: string;
  grossRevenue: string | number;     // includes shipping charged to customer
  refunds: string | number;
  discounts: string | number;
  taxCollected: string | number;
  netRevenue: string | number;
  basecost: string | number;          // sum(line.unitBasecost * qty); supplier shipping baked in
  paymentFees: string | number;
  fbAdSpend: string | number;
  otherAdSpend: string | number;
  appFees: string | number;
  operatingCost: string | number;
  grossProfit: string | number;
  netProfit: string | number;
  orderCount: number;
  refundedOrderCount?: number;
  currency: string;
  computedAt: string;
  isFinalized?: boolean;              // false for today's live row
}

export interface OperatingCostItem {
  id: string;
  date: string;
  category: string;
  description?: string | null;
  amount: string;
  currency: string;
}

export interface PLBreakdown {
  grossRevenue: number;
  refunds: number;
  discounts: number;
  taxCollected: number;
  netRevenue: number;
  basecost: number;
  paymentFees: number;
  fbAdSpend: number;
  otherAdSpend: number;
  appFees: number;
  operatingCost: number;
  grossProfit: number;
  netProfit: number;
  orderCount: number;
  refundedOrderCount: number;
}

export interface TodayLive {
  breakdown: PLBreakdown;
  date: string;
  computedAt: string;
  ageSeconds: number;
}

export class ProfitApiClient {
  private storeUrl: string;
  private accessToken: string;
  private timezone?: string;
  private base = '/api/pl';

  constructor(config: { storeUrl: string; accessToken: string; timezone?: string }) {
    this.storeUrl = config.storeUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
    this.accessToken = config.accessToken;
    this.timezone = config.timezone;
  }

  private headers() {
    return {
      'Content-Type': 'application/json',
      'X-Shopify-Store-Domain': this.storeUrl,
      'X-Shopify-Access-Token': this.accessToken,
      ...(this.timezone ? { 'X-Tz': this.timezone } : {})
    };
  }

  private async req<T = any>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      ...init,
      headers: { ...this.headers(), ...(init.headers || {}) }
    });
    const text = await res.text();
    let body: any = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    if (!res.ok) {
      const msg = body?.error || `${res.status} ${res.statusText}`;
      throw new Error(msg);
    }
    return body;
  }

  whoami() { return this.req<{ userId: string; storeId: string; storeDomain: string }>('/whoami'); }

  orderFees(from: Date, to: Date) {
    const q = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
    return this.req<{ fees: Record<string, { fee: number; gateway: string | null }>; count: number }>(`/order-fees?${q}`);
  }

  listSnapshots(from: Date, to: Date) {
    const q = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
    if (this.timezone) q.append('tz', this.timezone);
    return this.req<{
      snapshots: PLSnapshot[];
      tzOffsetMinutes: number;
      today: TodayLive | null; // present when range includes today
    }>(`/daily?${q}`);
  }

  /** Live today P&L. Server-memoised 5min/store. */
  getToday() {
    const q = new URLSearchParams();
    if (this.timezone) q.append('tz', this.timezone);
    return this.req<TodayLive & { tzOffsetMinutes: number }>(`/today?${q}`);
  }

  invalidateToday() {
    return this.req<{ ok: true }>('/today/invalidate', { method: 'POST' });
  }

  finalizeYesterday() {
    return this.req<PLBreakdown & { tzOffsetMinutes: number }>('/finalize-yesterday', {
      method: 'POST',
      body: JSON.stringify({ tz: this.timezone })
    });
  }

  preview(date: Date) {
    const q = new URLSearchParams({ date: date.toISOString() });
    if (this.timezone) q.append('tz', this.timezone);
    return this.req<PLBreakdown & { tzOffsetMinutes: number }>(`/preview?${q}`);
  }

  recompute(from: Date, to: Date) {
    return this.req<{ days: number }>('/recompute', {
      method: 'POST',
      body: JSON.stringify({ from: from.toISOString(), to: to.toISOString(), tz: this.timezone })
    });
  }

  recomputeDay(date: Date) {
    return this.req<PLBreakdown>('/recompute-day', {
      method: 'POST',
      body: JSON.stringify({ date: date.toISOString(), tz: this.timezone })
    });
  }

  syncOrders(opts: { since?: Date; until?: Date; pullTransactions?: boolean; syncBalances?: boolean } = {}) {
    return this.req<{
      ordersCreated: number;
      ordersUpdated: number;
      transactionsSynced: number;
      errors: any[];
      balance?: { updated: number; balanceRows: number; errors: string[] };
    }>('/sync-orders', {
      method: 'POST',
      body: JSON.stringify({
        since: opts.since?.toISOString(),
        until: opts.until?.toISOString(),
        pullTransactions: opts.pullTransactions !== false,
        syncBalances: opts.syncBalances !== false
      })
    });
  }

  syncBalances(since: Date, until: Date) {
    return this.req<{ updated: number; balanceRows: number; errors: string[] }>('/sync-balances', {
      method: 'POST',
      body: JSON.stringify({ since: since.toISOString(), until: until.toISOString() })
    });
  }

  recomputeCogs(from: Date, to: Date) {
    return this.req<{ ordersProcessed: number }>('/recompute-cogs', {
      method: 'POST',
      body: JSON.stringify({ from: from.toISOString(), to: to.toISOString() })
    });
  }

  importCostCsv(csv: string, supplier?: string) {
    return this.req<{
      totalRows: number;
      singleItemOrders: number;
      uniqueSkus: number;
      uniqueCountries: number;
      uniqueCarriers: number;
      pricebooksTouched: number;
      variantOverridesWritten: number;
      variantsBaseCostUpdated: number;
      shippingTiersUpdated: number;
      unmappedSkus: string[];
    }>('/import-cost-csv', { method: 'POST', body: JSON.stringify({ csv, supplier }) });
  }

  getStoreSettings() {
    return this.req<{ defaultShippingCompany: string | null; name: string | null; storeDomain: string }>('/store-settings');
  }

  updateStoreSettings(input: { defaultShippingCompany?: string | null }) {
    return this.req<{ defaultShippingCompany: string | null }>('/store-settings', {
      method: 'PUT',
      body: JSON.stringify(input)
    });
  }

  listShippingCompanies() {
    return this.req<{ items: Array<{ id: string; name: string; display_name: string | null; tracking_prefixes: string | null; is_active: boolean }> }>(
      '/shipping-companies'
    );
  }

  updateShippingCompany(id: string, input: { name?: string; display_name?: string; tracking_prefixes?: string; is_active?: boolean }) {
    return this.req(`/shipping-companies/${id}`, { method: 'PUT', body: JSON.stringify(input) });
  }

  backfillCarriers(windowDays = 30) {
    return this.req<{ scanned: number; updated: number; createdCarriers: string[]; errors: string[] }>('/backfill-carriers', {
      method: 'POST',
      body: JSON.stringify({ windowDays })
    });
  }

  seedPricebooks(input: { supplier?: string; shippingCompany?: string; currency?: string } = {}) {
    return this.req<{
      pricebooksCreated: number;
      pricebooksUpdated: number;
      tiersWritten: number;
      details: Array<{ country: string; supplier: string; carrier: string; pricebookId: string; tierCount: number }>;
    }>('/seed-pricebooks', { method: 'POST', body: JSON.stringify(input) });
  }

  byPeriod(from: Date, to: Date, period: 'day' | 'week' | 'month' | 'quarter' | 'year') {
    const q = new URLSearchParams({ from: from.toISOString(), to: to.toISOString(), period });
    return this.req<{
      period: string;
      buckets: Array<{
        periodKey: string;
        periodStart: string;
        periodEnd: string;
        grossRevenue: number; refunds: number; netRevenue: number;
        basecost: number; paymentFees: number;
        fbAdSpend: number; otherAdSpend: number; appFees: number; operatingCost: number;
        grossProfit: number; netProfit: number; orderCount: number;
      }>;
    }>(`/by-period?${q}`);
  }

  compare(from: Date, to: Date, period: 'day' | 'week' | 'month' | 'quarter' | 'year') {
    const q = new URLSearchParams({ from: from.toISOString(), to: to.toISOString(), period });
    return this.req<{
      period: string;
      current: any[];
      previous: any[];
      totals: {
        current: any;
        previous: any;
        deltaPct: Record<string, number | null>;
      };
    }>(`/compare?${q}`);
  }

  // syncFb removed: FacebookAdAccount + FacebookAdSpend tables dropped. Per-store
  // ad spend now flows through CampaignStoreMapping → live cache + EOD snapshots.

  listOperatingCosts(from: Date, to: Date) {
    const q = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
    return this.req<{ items: OperatingCostItem[] }>(`/operating-cost?${q}`);
  }

  createOperatingCost(input: { date: Date; category: string; amount: number; description?: string; currency?: string }) {
    return this.req<OperatingCostItem>('/operating-cost', {
      method: 'POST',
      body: JSON.stringify({
        date: input.date.toISOString(),
        category: input.category,
        amount: input.amount,
        description: input.description,
        currency: input.currency || 'USD'
      })
    });
  }

  deleteOperatingCost(id: string) {
    return this.req<{ ok: true }>(`/operating-cost/${id}`, { method: 'DELETE' });
  }
}
