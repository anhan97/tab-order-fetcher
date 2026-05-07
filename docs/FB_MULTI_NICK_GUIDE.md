# Hướng dẫn triển khai: Multi-nick Facebook + Asset & Ads Manager

Tài liệu này tổng hợp toàn bộ thiết kế của 2 chức năng đang chạy trong project hiện tại để bạn port sang project khác. Stack reference: **Express + Prisma (PostgreSQL) backend, React + Vite + TypeScript + shadcn/ui frontend**, JWT auth.

Hai chức năng được mô tả:

1. **Multi-nick Facebook** — mỗi user đăng ký N FB App (1 app / 1 FB nick) và kết nối FB Login riêng cho từng app. Khi user vào trang FB sẽ thấy bảng tổng kết các app + connection của họ.
2. **Asset & Ads Manager** — sau khi user kết nối, có 2 nhóm tab:
   - **Assets** với 3 sub-tab `Accounts | Business Managers | Ad Accounts` để add/remove vào hệ thống.
   - **Ads Manager** quản lý `Campaigns / Ad Sets / Ads` của 1 ad account đã enroll.

---

## 0. Triết lý thiết kế cốt lõi

| Vấn đề | Cách giải quyết |
|---|---|
| 1 FB App share cho nhiều user → flag 1 user kéo toàn bộ chết | **Mỗi user tự tạo FB App của riêng họ**, paste App ID + App Secret vào hệ thống. |
| 1 FB account giới hạn ad accounts → muốn quản nhiều nick | **1 user → N FB App** (mỗi nick 1 app). DB có composite unique `(userId, fbAppId)`. |
| FB SDK chỉ load được 1 App ID per page | Khi connect 1 app khác app default → tự động `setDefault` rồi `window.location.reload()`. |
| Token user dài 60 ngày → hết hạn vô tình | Cron `fb-token-refresh` chạy 24h/lần, gia hạn token nào còn ≤ 14 ngày. |
| FB API rate-limit theo BUC ad-account-level | Cache structure 6h + cache insights TTL theo độ "tươi" của date range. Một insights call `/insights?level=ad` lấy về toàn bộ campaigns/adsets/ads thay vì 3 calls. |
| Multi-tenant: 2 user cùng nhìn 1 ad account | In-flight dedup + cache key theo accountId, không theo userId. |

---

## 1. Database schema (Prisma)

### 1.1 User
```prisma
model User {
  id          String   @id @default(uuid())
  email       String   @unique
  password    String
  // 'user' | 'admin'. Bootstrap admin từ env ADMIN_EMAIL khi user đó login.
  role        String   @default("user")
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  fbApps        UserFacebookApp[]
  fbConnections UserFacebookConnection[]

  @@index([role])
}
```

### 1.2 UserFacebookApp — credentials per (user, FB App)
```prisma
model UserFacebookApp {
  id          String   @id @default(uuid())
  userId      String
  fbAppId     String                       // user's own FB App ID
  fbAppSecret String                       // plaintext, server-only access
  fbBmId      String?                      // optional Business Manager ID
  appName     String?                      // human label ("Nick A", "Brand B")
  isActive    Boolean  @default(true)
  isDefault   Boolean  @default(false)     // marker for default app
  lastError   String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, fbAppId])              // composite — user can register N apps
  @@index([userId])
  @@index([isActive])
}
```

### 1.3 UserFacebookConnection — FB Login token per (user, app)
```prisma
model UserFacebookConnection {
  id                  String   @id @default(uuid())
  userId              String
  fbAppId             String                       // value-FK to UserFacebookApp.fbAppId
  accessToken         String                       // long-lived (~60d) FB token
  fbUserId            String                       // returned from /debug_token
  fbUserName          String?
  expiresAt           DateTime?
  dataAccessExpiresAt DateTime?
  scopes              String?                      // JSON array as string
  lastRefreshedAt     DateTime?
  lastUsedAt          DateTime?
  lastError           String?
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, fbAppId])
  @@index([userId])
  @@index([fbAppId])
}
```

### 1.4 FacebookAdAccountAssignment — registry of ad accounts the system knows about
Một asset (ad account) có thể được nhiều user enroll, vì vậy tách bảng `Assignment` (1 row per account) và `Access` (1 row per (user, account)).

```prisma
model FacebookAdAccountAssignment {
  id            String   @id @default(uuid())
  accountId     String   @unique               // act_id without 'act_' prefix
  accountName   String
  status        String   @default("assigned")  // pending | assigned | failed | removed
  accountStatus Int?                           // FB account_status (1=ACTIVE)
  currency      String?
  timezone      String?
  lastSyncAt    DateTime @default(now())
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  accesses FacebookAdAccountAccess[]

  @@index([status])
}
```

### 1.5 FacebookAdAccountAccess — per-user enrollment
```prisma
model FacebookAdAccountAccess {
  id         String   @id @default(uuid())
  userId     String
  accountId  String                           // FK to Assignment.accountId
  role       String   @default("viewer")      // viewer | manager | admin
  isFavorite Boolean  @default(false)
  createdAt  DateTime @default(now())

  user       User                          @relation(fields: [userId], references: [id])
  assignment FacebookAdAccountAssignment   @relation(fields: [accountId], references: [accountId], onDelete: Cascade)

  @@unique([userId, accountId])
  @@index([userId])
  @@index([accountId])
}
```

> Nếu bạn không cần multi-tenant share, có thể merge thành 1 bảng `UserFacebookAdAccount`. Tách 2 bảng cho phép 2 users cùng có access tới account đó (agency model).

### 1.6 Migration backfill (nếu rebuild từ schema cũ "1 user → 1 app")
```sql
BEGIN;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "role" TEXT NOT NULL DEFAULT 'user';

-- Drop old singleton constraints, add composite uniques
ALTER TABLE "UserFacebookApp" DROP CONSTRAINT IF EXISTS "UserFacebookApp_userId_key";
ALTER TABLE "UserFacebookApp" ADD COLUMN IF NOT EXISTS "isDefault" BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE "UserFacebookApp" SET "isDefault" = TRUE;          -- legacy singleton becomes default
ALTER TABLE "UserFacebookApp"
  ADD CONSTRAINT "UserFacebookApp_userId_fbAppId_key" UNIQUE ("userId", "fbAppId");

ALTER TABLE "UserFacebookConnection" DROP CONSTRAINT IF EXISTS "UserFacebookConnection_userId_key";
ALTER TABLE "UserFacebookConnection" ADD COLUMN IF NOT EXISTS "fbAppId" TEXT;

UPDATE "UserFacebookConnection" c
SET    "fbAppId" = a."fbAppId"
FROM   "UserFacebookApp" a
WHERE  a."userId" = c."userId" AND c."fbAppId" IS NULL AND a."isDefault" = TRUE;

DELETE FROM "UserFacebookConnection" WHERE "fbAppId" IS NULL;
ALTER TABLE "UserFacebookConnection" ALTER COLUMN "fbAppId" SET NOT NULL;
ALTER TABLE "UserFacebookConnection"
  ADD CONSTRAINT "UserFacebookConnection_userId_fbAppId_key" UNIQUE ("userId", "fbAppId");

COMMIT;
```

---

## 2. Backend — Services

### 2.1 `user-fb-app.service.ts`

API surface:
```ts
listForUser(userId): SafeFbApp[]                                  // mask secrets, sort default first
resolveForUser(userId, fbAppId | null): ResolvedFbApp | null      // null = pick default
upsert(userId, { fbAppId, fbAppSecret, fbBmId?, appName?, makeDefault? }): SafeFbApp
setDefault(userId, fbAppId): void                                 // transaction: clear all + set 1
deleteApp(userId, fbAppId): void                                  // also drops matching connection
markError(userId, fbAppId, error): void
```

Implementation notes:
- 60s in-memory cache `Map<userId:fbAppId, ResolvedFbApp>` để tránh hit DB mỗi request.
- `secretFingerprint` = `${secret.slice(0,4)}••••${secret.slice(-4)} (len=${len})` — không bao giờ trả về plaintext qua API.
- `setDefault` chạy trong transaction: `UPDATE … SET isDefault=FALSE WHERE userId=$1` rồi `UPDATE … SET isDefault=TRUE WHERE (userId, fbAppId)=...`.
- `deleteApp`: xóa `UserFacebookConnection` trước (vì FK by value, không có CASCADE), sau đó xóa app, rồi promote oldest surviving app thành default nếu vừa xóa default.

### 2.2 `fb-user-token.service.ts`

```ts
connect(userId, shortToken, fbAppId | null): ConnectionStatus
extend(userId, fbAppId | null): { expiresAt, fbAppId } | null     // re-runs fb_exchange_token
listExpiringSoon(windowDays): { userId, fbAppId, expiresAt }[]    // for cron
getRawTokenForApp(userId, fbAppId): { token, fbAppId } | null
listConnections(userId): ConnectionStatus[]
disconnect(userId, fbAppId | null): void                           // null = drop all rows for user
markUsed(userId, fbAppId | null): void
```

**Token exchange flow** (short-lived → long-lived 60d):
```ts
const cfg = await resolveUserApp(userId, fbAppId);           // resolves which app's secret to use
const url = `https://graph.facebook.com/v23.0/oauth/access_token?` +
  `grant_type=fb_exchange_token&` +
  `client_id=${cfg.fbAppId}&` +
  `client_secret=${cfg.fbAppSecret}&` +
  `fb_exchange_token=${shortToken}`;
const res = await fetch(url);
// FB error code 1 hoặc /client secret/i → app secret sai → tag riêng để FE hiển thị "kiểm tra app secret".
```

**`/debug_token` để pull metadata** (gọi ngay sau exchange):
```ts
const url = `https://graph.facebook.com/v23.0/debug_token?` +
  `input_token=${longToken}&access_token=${longToken}`;
// Trả về data.user_id, data.expires_at (epoch seconds, 0 = never), data.data_access_expires_at, data.scopes[]
```

**Insert / upsert** dùng raw SQL với `ON CONFLICT ("userId", "fbAppId") DO UPDATE` để đảm bảo idempotent:
```sql
INSERT INTO "UserFacebookConnection" (...) VALUES (...)
ON CONFLICT ("userId", "fbAppId") DO UPDATE SET
  "accessToken" = EXCLUDED."accessToken",
  ...
  "lastError" = NULL,
  "updatedAt" = NOW()
```

**`getStatus(userId, fbAppId | null)`** trả về:
```ts
{
  connected: boolean,           // = !isExpired
  fbAppId: string | null,
  fbUserId, fbUserName,
  expiresAt, dataAccessExpiresAt,
  daysUntilExpiry: number | null,
  needsReconnect: boolean,      // soft warning: < 3d hoặc lastError != null
  scopes, lastRefreshedAt
}
```
Cần phân biệt `connected` (hard — token còn dùng được) và `needsReconnect` (soft — cần nhắc user) để tránh F5 page nào cũng force reconnect.

### 2.3 `fb-token-refresh` cron
```ts
const REFRESH_WINDOW_DAYS = 14;
const INTERVAL_MS = 24 * 60 * 60 * 1000;
const BOOT_DELAY_MS = 5 * 60 * 1000;   // wait 5 min after boot

async function runOnce() {
  const candidates = await fbToken.listExpiringSoon(14);
  for (const row of candidates) {
    try { await fbToken.extend(row.userId, row.fbAppId); }
    catch (e) { await fbToken.markError(row.userId, row.fbAppId, e.message); }
  }
}
```

### 2.4 `fb-assets.service.ts` — list/enroll/unenroll

```ts
listAssets(userId, token): Promise<{
  adAccounts: AdAccountAsset[],   // tagged enrolled=true/false
  pages: PageAsset[],
  businesses: BusinessAsset[]
}>
enrollAdAccount(userId, accountId, name): Promise<{ enrolled: true }>
unenrollAdAccount(userId, accountId): Promise<{ enrolled: false }>
```

3 calls Graph API song song (`Promise.all`):
```
GET /me/adaccounts?fields=id,name,account_status,currency,timezone_name,business,owner&limit=200
GET /me/accounts?fields=id,name,category,instagram_business_account&limit=200
GET /me/businesses?fields=id,name&limit=200
```

Sau đó join với `FacebookAdAccountAccess` của user để gắn `enrolled: boolean` lên mỗi `adAccount`.

**Account status labels** (cố định, FE hiển thị bằng tiếng Việt):
```
1   → Hoạt động
2   → Vô hiệu hoá
3   → Chưa thanh toán
7   → Đang xác thực
8   → Khoá vĩnh viễn
9   → Hạn chế tạm thời
100 → Đóng
101 → Bị khoá
201/202 → Khoá để bảo mật
```

**Enroll**: upsert `FacebookAdAccountAssignment` (idempotent on `accountId`) + upsert `FacebookAdAccountAccess` `(userId, accountId)`.

**Unenroll**: chỉ `DELETE FROM FacebookAdAccountAccess WHERE (userId, accountId)`. Giữ `Assignment` row vì có thể user khác vẫn enroll. **Không xóa** lịch sử spend snapshots.

### 2.5 `fb-account-data.service.ts` — Ads Manager backbone

Đây là service quan trọng nhất. Mục tiêu: render "FB Ads Manager view cho 1 ad account + date range" với **2 calls** (thay vì 3+):

```
1. ONE call /act_<id>/insights?level=ad         → toàn bộ insights theo ad
2. ONE cached call /act_<id>?fields=campaigns{...,adsets{...,ads{...}}}
                                                  → structure (names, status, budget, creative)
3. Merge + rollup tại layer service.
```

#### Insights call

Fields đầy đủ:
```
ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,
spend,impressions,clicks,unique_clicks,reach,frequency,
ctr,unique_ctr,cpc,cpm,cost_per_unique_click,
actions,action_values,cost_per_action_type,
purchase_roas,website_purchase_roas,
inline_link_clicks,inline_link_click_ctr,
video_play_actions,video_p25_watched_actions,
video_p50_watched_actions,video_p75_watched_actions,video_p100_watched_actions
```

Date range:
- `since == until == today (UTC)` → `date_preset=today` (FB sẽ resolve theo TZ ad account, tránh off-by-one).
- Ngược lại → `time_range={"since":"YYYY-MM-DD","until":"YYYY-MM-DD"}`.

Pagination với `limit=500`, theo dõi `paging.next` cho đến hết hoặc `pageCount > 250` (= 125k ads — trên đó phải dùng async insights jobs).

#### Structure call

```
/act_<id>?fields=campaigns.limit(500){
  id,name,status,effective_status,objective,daily_budget,lifetime_budget,start_time,stop_time,
  adsets.limit(500){
    id,name,status,effective_status,campaign_id,daily_budget,lifetime_budget,
    ads.limit(500){
      id,name,status,effective_status,adset_id,campaign_id,
      creative{id,thumbnail_url,image_url,body,title,call_to_action_type}
    }
  }
}
```

Cache 6h (`STRUCTURE_TTL`) — campaign/adset/ad name & status không thay đổi từng phút.

#### Cache TTL theo tuổi date range

```ts
ttlForRange(until: Date) {
  const daysAgo = (Date.now() - until.getTime()) / 86_400_000;
  if (daysAgo < 0)  return 5 * 60_000;       // future / today  → 5 min
  if (daysAgo < 1)  return 5 * 60_000;       // today           → 5 min
  if (daysAgo < 2)  return 30 * 60_000;      // yesterday       → 30 min
  if (daysAgo < 7)  return 60 * 60_000;      // last week       → 1 h
  return 12 * 60 * 60_000;                   // older           → 12 h
}
```

#### In-flight dedup

```ts
const inflight = new Map<string, Promise<any>>();

async function fetchX(key) {
  if (inflight.has(key)) return inflight.get(key)!;
  const promise = (async () => { ... })().finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}
```
→ 10 user concurrent xem cùng 1 account = 1 fetch thật, 9 share kết quả.

#### Rollup parents

Sau khi có `ads[]` từ insights, gom lại theo `adset_id` + `campaign_id`, sum lên cho parent rows. **Không** average ratios (ctr, cpc, …) — phải recompute từ tổng:
```ts
ctr = impressions ? (clicks / impressions) * 100 : 0
cpc = clicks ? spend / clicks : 0
cpm = impressions ? (spend / impressions) * 1000 : 0
roas = spend ? purchaseValue / spend : 0
```

#### Token resolution priority

```ts
function resolveToken(accountId, fallbackToken) {
  if (fallbackToken && fallbackToken.length > 0) return fallbackToken;
  // optional: pool fallback if you support multi-tenant system tokens
  throw new Error('No FB token available');
}
```

### 2.6 Rate-limit awareness

FB trả `X-Business-Use-Case-Usage` header trên mỗi response. Parse JSON, lấy `total_time` / `total_cputime` / `call_count` per ad account. Lưu in-memory map. Nếu bất kỳ field nào > 95% → set backoff cho account đó:

```ts
shouldBackoff(accountId): number   // ms to wait, 0 if OK
recordUsageFromHeaders(accountId, headers): void
getAccountUsage(accountId): { totalTime, callCount, ... }
```

Nếu wait > 30s → throw cho FE biết "rate-limited, retry later". Wait < 30s → `await setTimeout(wait)` và retry tiếp.

---

## 3. Backend — Routes

### 3.1 Multi-app management

Tất cả routes dưới đây đều `requireAuth` (Bearer JWT) + `resolveStore` (nếu app multi-store) để có `req.userId`.

```
GET    /api/facebook/my-apps                       → SafeFbApp[]
POST   /api/facebook/my-apps                       → register new app
PUT    /api/facebook/my-apps/:fbAppId              → update fields
PUT    /api/facebook/my-apps/:fbAppId/default      → promote to default
DELETE /api/facebook/my-apps/:fbAppId              → delete app + matching connection

GET    /api/facebook/connections                   → ConnectionStatus[]
POST   /api/facebook/connections                   → body { token, fbAppId }
DELETE /api/facebook/connections/:fbAppId          → disconnect 1 nick

POST   /api/facebook/my-app/test                   → kiểm tra default app credentials qua client_credentials grant
```

**Validation cho POST `/my-apps`**:
- `fbAppId`: phải match `/^\d{8,20}$/`.
- `fbAppSecret`: length >= 16.
- `appName`, `fbBmId`: optional, trim + null fallback.

### 3.2 Asset management

```
GET    /api/facebook/assets                              → AssetSnapshot
POST   /api/facebook/assets/ad-accounts/:accountId/enroll
DELETE /api/facebook/assets/ad-accounts/:accountId
```

Token cho `/assets`: lấy từ `fbToken.getRawToken(userId)` — default app's token. Nếu null → 401 với `reason: 'no_connection'`.

### 3.3 Ads Manager

```
GET /api/facebook/account-data?accountId=X&since=ISO&until=ISO
  → { campaigns, adsets, ads, meta: { fetchedAt, cacheHit, accountUsage } }
```

Error mapping (FB code → HTTP status + reason tag):
```
code 190 + msg "application does not belong to system user" → 403, reason: 'app_not_in_bm'
code 190 (other)                                            → 401, reason: 'expired_token'
code 200 / code 10                                          → 403, reason: 'missing_permission'
code 17 / 4 / 32 / 613, msg /rate-limited|throttle/         → 429, reason: 'rate_limit'
default                                                     → 500, reason: 'unknown'
```

---

## 4. Frontend — Components

### 4.1 `FacebookAppsManager.tsx` — multi-nick UI

Component chính cho tab "FB App". Hiển thị:
- Header với nút **Add app** (Dialog form: appName, fbAppId, fbAppSecret, fbBmId, makeDefault checkbox).
- List rows. Mỗi row:
  - Badge `Default` (sao vàng) + Connected/Not connected status + tên user FB + `Expires in Nd` nếu < 7d.
  - Mono App ID + BM ID + link mở Dev Console.
  - `lastError` (nếu có) hiển thị màu rose.
  - Actions: ⭐ Set default · LogIn Connect/Reconnect · Edit · Disconnect · 🗑 Delete.

#### Connect logic per row (quan trọng)

```ts
const connectApp = async (app: SafeFbApp) => {
  const activeAppId = FacebookAdsApiClient.getActiveAppId();
  const sdkLoaded = !!(window as any).FB;

  // SDK đã init với app khác → make-default + reload là cách clean nhất.
  if (sdkLoaded && activeAppId && activeAppId !== app.fbAppId) {
    if (!confirm(`SDK đang dùng app ${activeAppId}, bạn muốn dùng ${app.fbAppId}? Reload page để áp dụng?`)) return;
    await apiFetch(`/api/facebook/my-apps/${app.fbAppId}/default`, { method: 'PUT' });
    window.location.reload();
    return;
  }

  // SDK chưa init hoặc đang đúng app → login + post token.
  FacebookAdsApiClient.configureAppId(app.fbAppId);
  const client = FacebookAdsApiClient.getInstance();
  const { accessToken } = await client.login({ rerequest: false });
  await apiFetch('/api/facebook/connections', {
    method: 'POST',
    body: JSON.stringify({ token: accessToken, fbAppId: app.fbAppId })
  });
};
```

#### Edit dialog

- Disable input `fbAppId` khi edit (App ID là natural key).
- App Secret để trống → giữ secret cũ (server-side).
- Button "Test" gọi `/my-app/test` (chỉ dùng được khi app là default).
- Hiển thị `app.lastError` ở dưới.

### 4.2 `FacebookAssetManager.tsx` — 3 sub-tab

**Layout**:
```
[Search input "Tìm theo tên, ID, BM..."]   [Refresh từ Facebook]

┌──────────────────────────────────────────────────────┐
│ Tabs: Tài khoản quảng cáo | Pages | Business Manager │
├──────────────────────────────────────────────────────┤
│ Stats strip: "X đã add · Y available"                │
│ Filter chips: All | Đã add | Available               │
│                                                      │
│ Table: Account | Status | Type | Currency | BM       │
│        | Sync status | Action (Add / Remove)         │
└──────────────────────────────────────────────────────┘
```

**State**:
```ts
const [data, setData] = useState<AssetSnapshot | null>(null);
const [tab, setTab] = useState<'ad-accounts' | 'pages' | 'businesses'>('ad-accounts');
const [search, setSearch] = useState('');
const [enrolmentFilter, setEnrolmentFilter] = useState<'all' | 'enrolled' | 'available'>('all');
const [busyId, setBusyId] = useState<string | null>(null);   // disable button đang thao tác
```

**Filter logic** (memoized):
```ts
filteredAdAccounts = data.adAccounts.filter(a => {
  if (enrolmentFilter === 'enrolled' && !a.enrolled) return false;
  if (enrolmentFilter === 'available' && a.enrolled) return false;
  if (search && !a.name.toLowerCase().includes(q) &&
                !a.accountId.includes(q) &&
                !(a.business?.name.toLowerCase().includes(q))) return false;
  return true;
});
```

**Pages tab**: read-only table với cột `Page | Category | Instagram (✓/×)`.
**Businesses tab**: read-only với cột `BM | ID` + link tới `business.facebook.com/settings/...`.

> Sub-tab Pages/BM read-only vì hệ thống không enroll page/BM riêng — chúng chỉ là thông tin cho UI dropdown và để user biết FB account đang truy cập được những gì.

### 4.3 `FacebookAdsManager.tsx` — Campaigns / Ad Sets / Ads

Component lớn nhất (~1100 lines). Highlight thiết kế:

#### Props
```ts
interface Props {
  account: FacebookAdAccount;
  onSpendUpdate: (spend: number) => void;
  dateRange: { from: Date; to: Date };
  onDateRangeChange: (range) => void;
  selectedPreset: DatePreset;
  onPresetChange: (preset) => void;
}
```

Date range + preset được **lift** lên parent (`FacebookPage`) để Analytics + Ads Manager share state.

#### Data flow

```ts
const { data } = await fetchAdAccountData(accountId, since, until);
// → calls GET /api/facebook/account-data?accountId=X&since=...&until=...
// → backend trả {campaigns[], adsets[], ads[], meta}
```

#### Tab structure (3 inner tabs)

```tsx
<Tabs value={level} onValueChange={setLevel}>
  <TabsList>
    <TabsTrigger value="campaigns">Campaigns ({campaigns.length})</TabsTrigger>
    <TabsTrigger value="adsets">Ad Sets ({adsets.length})</TabsTrigger>
    <TabsTrigger value="ads">Ads ({ads.length})</TabsTrigger>
  </TabsList>
  <TabsContent value="campaigns"><Table .../></TabsContent>
  ...
</Tabs>
```

#### Metrics config (configurable visible columns)

```ts
const METRICS_CONFIG = [
  { key: 'spend',            label: 'Spend',            format: 'currency', defaultVisible: true },
  { key: 'impressions',      label: 'Impressions',      format: 'number',   defaultVisible: true },
  { key: 'reach',            label: 'Reach',            format: 'number',   defaultVisible: true },
  { key: 'clicks',           label: 'Clicks',           format: 'number',   defaultVisible: true },
  { key: 'cpc',              label: 'CPC',              format: 'currency', defaultVisible: true },
  { key: 'ctr',              label: 'CTR',              format: 'percent',  defaultVisible: true },
  { key: 'cpm',              label: 'CPM',              format: 'currency', defaultVisible: true },
  { key: 'frequency',        label: 'Frequency',        format: 'decimal',  defaultVisible: true },
  { key: 'add_to_cart',      label: 'Add to Cart',      format: 'number',   defaultVisible: true },
  { key: 'initiate_checkout',label: 'Init Checkout',    format: 'number',   defaultVisible: true },
  { key: 'purchase',         label: 'Purchase',         format: 'number',   defaultVisible: true },
  { key: 'roas',             label: 'ROAS',             format: 'decimal',  defaultVisible: true },
  // ... thêm: hook_rate, video_plays, cost_per_result, ...
];
```

Cột nào bật/tắt lưu vào `localStorage`.

#### Sort + filter + drag-reorder columns

Dùng `@hello-pangea/dnd` (fork của react-beautiful-dnd) cho drag column header.

#### Status pill

```tsx
<StatusPill status={ad.effective_status}>
  {ad.effective_status === 'ACTIVE' ? 'Active' : ad.effective_status === 'PAUSED' ? 'Paused' : ...}
</StatusPill>
```

#### Empty / loading / error states

- Loading: spinner toàn bảng.
- Error code 190 expired_token → show `<FacebookReconnectDialog />`.
- Error code 17/4/32 rate_limit → countdown timer + retry button.
- Error code 200 missing_permission → link FB App Review docs.

---

## 5. Frontend — Page tổ chức

```tsx
// pages/FacebookPage.tsx
export const FacebookPage = () => {
  const { isFacebookConnected, selectedAccount, dateRange, ... } = useAppContext();

  if (!isShopifyConnected) return <ConnectShopifyFirst />;

  // Connect screen — show MyFacebookAppCard + FacebookAdsConnection
  if (!isFacebookConnected || !selectedAccount) {
    return (
      <>
        <MyFacebookAppCard />
        <FacebookAdsConnection onConnectionSuccess={...} />
      </>
    );
  }

  // Main view khi đã connect
  return (
    <>
      <ConnectionStripCard />     {/* Connected status + Disconnect button */}
      <Tabs defaultValue="assets">
        <TabsList>
          <TabsTrigger value="assets">Assets</TabsTrigger>
          <TabsTrigger value="dashboard">Ads Manager</TabsTrigger>
          <TabsTrigger value="diagnostics">Diagnostics</TabsTrigger>
          <TabsTrigger value="apps">FB Apps</TabsTrigger>
        </TabsList>

        <TabsContent value="assets"><FacebookAssetManager /></TabsContent>
        <TabsContent value="dashboard"><FacebookAdsManager account={selectedAccount} ... /></TabsContent>
        <TabsContent value="diagnostics"><FacebookDiagnostics /></TabsContent>
        <TabsContent value="apps"><FacebookAppsManager /></TabsContent>
      </Tabs>
    </>
  );
};
```

> Theo yêu cầu của user: "Khi user đăng nhập vào sẽ hiển thị ra bảng accounts trước" → `defaultValue="assets"` (sub-tab `ad-accounts` cũng là default trong `FacebookAssetManager`).

---

## 6. Frontend — `FacebookAdsApiClient` (FB SDK helper)

Singleton wrapper quanh FB JS SDK:

```ts
class FacebookAdsApiClient {
  private static instance: FacebookAdsApiClient;
  private static configuredAppId: string | null = null;

  static getInstance() { ... }
  static getActiveAppId() { return this.configuredAppId; }
  static configureAppId(appId: string | null) {
    this.configuredAppId = appId;
    // Inject FB SDK script with this appId nếu chưa load.
  }

  private async ensureSDK(): Promise<void> {
    if ((window as any).FB) return;
    return new Promise((resolve, reject) => {
      // Append <script src="https://connect.facebook.net/en_US/sdk.js">
      // window.fbAsyncInit = () => { FB.init({ appId, version: 'v23.0' }); resolve(); };
      // script.onerror = () => reject(new Error('Facebook SDK load failed'));
    });
  }

  async login({ rerequest = false } = {}): Promise<{ accessToken, userId }> {
    await this.ensureSDK();
    return new Promise((resolve, reject) => {
      FB.login(response => {
        if (!response.authResponse) return reject(new Error('Cancelled'));
        // Verify scopes via FB.api('/me/permissions') — nếu user untick →
        // throw Error có .code='missing_scopes', .missingScopes=[...]
        resolve({ accessToken: response.authResponse.accessToken, userId: response.authResponse.userID });
      }, {
        scope: 'public_profile,email,ads_read,ads_management,business_management,pages_read_engagement,pages_show_list,read_insights',
        auth_type: rerequest ? 'rerequest' : undefined
      });
    });
  }

  async getAdAccounts(): Promise<{ id, name }[]> { ... }   // FB.api('/me/adaccounts', ...)
}
```

**Why this matters for multi-app**:
- `configureAppId(appId)` **trước khi** load SDK (lý tưởng) — nếu SDK đã load rồi, `configureAppId` chỉ update biến tracking, không re-init được FB. Đó là lý do `connectApp` phải reload page khi app khác.
- Khi page mount, `MyFacebookAppCard` hoặc `FacebookAppsManager` gọi `configureAppId(defaultApp.fbAppId)` ngay → SDK init với app đúng → user click Connect không bị mismatch.

---

## 7. Auth Context (FE)

```ts
interface AuthUser {
  id, email, firstName, lastName, isVerified,
  role?: string;     // 'admin' shows admin nav item, otherwise hidden
}
```

`AuthContext` bootstrap khi mount:
1. Đọc JWT từ `localStorage.auth_token`.
2. Gọi `GET /api/auth/me` → set user.
3. Gọi `GET /api/auth/stores` → set stores list.

`apiFetch` wrapper auto-inject `Authorization: Bearer ${token}` + `X-Shopify-Store-Domain: ${activeStore}` header.

---

## 8. UX flow tổng quan

### 8.1 First-time setup
```
1. Register → Login          → JWT
2. Add Shopify store         → required by ProtectedRoute
3. Vào /facebook
   - User chưa có FB App  → MyFacebookAppCard nhắc tạo + paste credentials
   - User đã có default app → FacebookAdsConnection cho FB Login
4. FB Login mint short token → POST /api/facebook/connect (or /connections)
   → backend exchange long-lived → store DB
5. Redirect vào tab Assets   → load /api/facebook/assets
6. User pick which ad accounts to enroll → enroll button
7. Switch sang tab Ads Manager → pick 1 account → render campaigns/adsets/ads
```

### 8.2 Add nick mới (nick #2)
```
1. /facebook → tab "FB Apps"
2. Click [Add app] dialog → paste fbAppId B + fbAppSecret B + appName "Nick B"
   → POST /api/facebook/my-apps
3. Click [Set default] (Star icon) trên row của Nick B
4. Click [Connect] trên row Nick B
   → confirm dialog "SDK loaded with app A, reload to use app B?"
   → PUT /my-apps/{B}/default → window.location.reload()
5. Sau reload, page mount → FacebookAdsApiClient.configureAppId(B)
   → FB.init({appId: B, ...})
6. Click [Connect] trên row Nick B lần nữa
   → FB.login → short token
   → POST /api/facebook/connections { token, fbAppId: B }
   → DB có 2 connections: (user, A) và (user, B)
```

### 8.3 Switch giữa nicks
- Mỗi nick có connection riêng + access tới ad accounts riêng.
- User picker: list `/api/facebook/connections` → `[{ fbAppId, fbUserName, connected, daysUntilExpiry }, ...]`.
- Khi user pick connection X → set "active fbAppId" trong Context → mọi gọi sau đến `/api/facebook/account-data` đính kèm header `X-FB-App-Id: X` (backend chọn token từ `getRawTokenForApp(userId, X)`).

> Implementation hiện tại của project source dùng default app làm active. Để hoàn chỉnh multi-nick switching, cần extend `getRawToken` → `getRawTokenForApp` ở mọi route (assets, account-data, …) và FE truyền fbAppId vào context.

---

## 9. Cron / background jobs

### 9.1 Token refresh
```
Boot delay 5 min → run once → setInterval 24h
Mỗi cycle:
  candidates = listExpiringSoon(14)
  for c: extend(c.userId, c.fbAppId) || markError on fail
```

### 9.2 (Optional) Daily ad insights snapshot
Khi cần lưu lịch sử per-day (cho P&L hoặc historical view):
```
Mỗi ad account đã enroll:
  for each day in [yesterday-7days, yesterday]:
    if FacebookAdInsightSnapshot không có row → fetch /insights?level=ad → insert
```

Schema:
```prisma
model FacebookAdInsightSnapshot {
  id          String   @id @default(uuid())
  accountId   String
  date        DateTime              // UTC midnight của ngày
  level       String                // 'account' | 'campaign' | 'adset' | 'ad'
  entityId    String                // PK theo level
  entityName  String?
  parentId    String?
  spend       Decimal  @db.Decimal(12,2) @default(0)
  impressions BigInt   @default(0)
  clicks      BigInt   @default(0)
  reach       BigInt   @default(0)
  purchases   Int      @default(0)
  purchaseValue Decimal @db.Decimal(12,2) @default(0)
  raw         Json?
  createdAt   DateTime @default(now())

  @@unique([accountId, date, level, entityId])
}
```

---

## 10. Checklist port sang project mới

### Backend
- [ ] Prisma schema: User (role), UserFacebookApp, UserFacebookConnection, FacebookAdAccountAssignment, FacebookAdAccountAccess.
- [ ] Migration với composite unique `(userId, fbAppId)`.
- [ ] Service `user-fb-app.service` — CRUD + setDefault + cache.
- [ ] Service `fb-user-token.service` — connect/extend/disconnect/getStatus + listExpiringSoon.
- [ ] Service `fb-assets.service` — listAssets + enroll/unenroll.
- [ ] Service `fb-account-data.service` — `getAccountData()` 2-call orchestrator + cache + dedup.
- [ ] Service `fb-rate-limit` (in-memory) — record from headers + shouldBackoff.
- [ ] Service `fb-cache` (in-memory or Redis) — `get/set/invalidate` + `STRUCTURE_TTL` + `ttlForRange()`.
- [ ] Middleware `requireAuth` (JWT) + `requireAdmin` (role-gated).
- [ ] Routes:
  - [ ] `/api/auth/{register,login,me,stores}`
  - [ ] `/api/facebook/my-apps[/:fbAppId][/default]` CRUD
  - [ ] `/api/facebook/connections[/:fbAppId]`
  - [ ] `/api/facebook/assets` + `/assets/ad-accounts/:accountId/{enroll,DELETE}`
  - [ ] `/api/facebook/account-data?accountId=&since=&until=`
- [ ] Cron `fb-token-refresh` (5min boot delay, 24h interval).
- [ ] FB Graph version constant (`v23.0` tại thời điểm viết — kiểm tra latest).

### Frontend
- [ ] `FacebookAdsApiClient` singleton wrapper FB SDK + `configureAppId()`.
- [ ] `apiFetch` wrapper inject Bearer + active store header.
- [ ] `AuthContext` với `role` field.
- [ ] `MyFacebookAppCard` (single-app form, fallback cho first-time).
- [ ] `FacebookAdsConnection` (FB Login button + missing-scopes / app-not-authorized error UI).
- [ ] `FacebookAppsManager` (multi-app list + dialog form + per-row Connect/Disconnect).
- [ ] `FacebookAssetManager` (3 sub-tab Accounts / Pages / BM, search, filter chips, enroll/unenroll).
- [ ] `FacebookAdsManager` (campaigns/adsets/ads tabs, metric column toggle, drag reorder, sort).
- [ ] `FacebookPage` orchestration (connect screen vs main view, lift dateRange + selectedAccount lên context).
- [ ] (Optional) `AdminPage` — users table với FB app/connection counts.

### Testing
- [ ] Unit test `fb-account-data.shapeAdRow` + `rollupParents` (pure functions, dễ test).
- [ ] Unit test `fb-diagnose.classify` nếu port luôn diagnostics.
- [ ] Integration: end-to-end FB Login + enroll + render Ads Manager với mock FB Graph.

---

## 11. Lưu ý quan trọng

1. **FB SDK chỉ init 1 lần per page** — không có cách nào re-init với appId khác. Workaround: reload page khi switch app.
2. **App Secret không bao giờ trả về plaintext qua API** — chỉ fingerprint `xxxx••••yyyy (len=N)`.
3. **Token lưu plaintext trong DB** trong implementation hiện tại (server-only access, không expose qua API). Nếu yêu cầu encryption-at-rest, dùng AES-256-GCM với key trong env, prefix `enc:` để discriminate legacy plaintext rows.
4. **Account status = 1 mới active** — các status khác (2,3,7,8,9,100,101,201,202) đều bị FB chặn API calls.
5. **`/me/adaccounts` chỉ trả accounts có role với user**, không trả accounts trong BM mà user không là member.
6. **`actions[]` array trong insights** dùng `pickAction()` helper để extract giá trị — purchase có thể trong key `purchase` HOẶC `offsite_conversion.fb_pixel_purchase` (tuỳ pixel setup).
7. **`purchase_roas` là array** — `purchase_roas[0].value` là ROAS chính. Nếu là array rỗng → ROAS = 0.
8. **Date today UTC vs account TZ**: dùng `date_preset=today` chứ không `time_range` cho ngày hôm nay; FB sẽ resolve theo TZ của ad account → tránh off-by-one ở các account TZ Mỹ/Úc.
9. **Compliance/policy isolation**: nếu 1 user app bị FB flag, chỉ user đó bị ảnh hưởng — đó là động lực chính của "mỗi user 1 app".
10. **Rate limit BUC (Business Use Case)** mới là bottleneck thực ở scale, không phải App-level (60 score/h cho dev tier). BUC tự rotate theo từng ad account, scale với # active ads.

---

## 12. References (FB official)

- Graph API: https://developers.facebook.com/docs/graph-api/overview
- Long-lived token exchange: https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived
- `/debug_token`: https://developers.facebook.com/docs/facebook-login/guides/access-tokens/debugging
- Marketing API insights fields: https://developers.facebook.com/docs/marketing-api/insights/parameters
- Rate limiting: https://developers.facebook.com/docs/graph-api/overview/rate-limiting
- App Review for ads scopes: https://developers.facebook.com/docs/permissions/reference

---

End of guide.
