# Đặc tả chức năng Ads Launcher: chọn creative rồi lên campaign Meta

Phiên bản 1.0 · 07/10/2026 · Dựng lại từ bản đang chạy trong Adlux Promax (đã test bằng trình duyệt trên tài khoản demo).

## 0. Cách dùng tài liệu này

- Tài liệu mô tả đủ để dựng lại chức năng ở một dự án khác: luồng người dùng, dữ liệu, thuật toán chia cấu trúc, API, các lệnh gọi Meta Marketing API, phân quyền, xử lý lỗi và cách test.
- Tên trường, tên hàm và giá trị enum giữ nguyên tiếng Anh để copy thẳng vào code.
- Mục "Tham chiếu Adlux" ở cuối liệt kê file gốc để đọc code mẫu. Dự án mới không bắt buộc dùng cùng stack.
- Stack tham chiếu: Node 22, Express 5, Prisma 6, Postgres, Redis (backend); React 18, TanStack Query, shadcn (frontend); zod dùng chung hai đầu; Meta Graph API v23.0.

## 1. Chức năng làm gì

Người chạy ads chọn N creative (ảnh hoặc video có sẵn trong thư viện, hoặc bài post cũ đã từng chạy), chọn một preset (cấu trúc và cài đặt), chọn ad account, pixel, page, landing page, rồi bấm Launch. Hệ thống tạo trên Meta campaign → ad set → ad theo đúng cấu trúc, rồi lưu bản sao (mirror) vào DB để Ads Manager nội bộ hiện ngay và để analytics biết ad nào sinh ra từ creative nào.

Năm khả năng chính:

1. **Lên ads hàng loạt từ thư viện creative.** Mỗi creative thành một hoặc nhiều ad.
2. **Cấu trúc `C:S:A`** (số campaign : số ad set mỗi campaign : số ad mỗi ad set). Mỗi cấp là một số hoặc `n`. Có chế độ lặp creative cho đủ số ad.
3. **Preset** lưu sẵn cấu trúc và cài đặt: budget CBO hoặc ABO, bid strategy, mục tiêu tối ưu, audience, CTA, trạng thái.
4. **Dùng lại bài post cũ** bằng post ID: ad mới chạy đúng bài cũ, giữ nguyên like, comment, share.
5. **Phân quyền**: admin thấy và dùng được tất cả; người khác chỉ thấy ad account, page, pixel, store và creative của mình.

## 2. Thuật ngữ

| Thuật ngữ | Nghĩa |
| --- | --- |
| Creative | Một file ảnh hoặc video trong thư viện, kèm copy (primary text, headline, description), gắn với một sản phẩm và một angle. |
| Meta creative | Đối tượng `adcreative` bên Meta. Không sửa được (immutable): muốn đổi copy phải tạo creative mới rồi gắn vào ad. |
| Post ID | Bài đăng của page mà ad chạy, dạng `<pageId>_<postId>`. Meta gọi là `effective_object_story_id`. |
| Pool | Danh sách item được chọn để launch, giữ thứ tự chọn. Item là creative (`<uuid>`) hoặc post (`post:<postId>`). |
| Preset | Cấu hình lưu sẵn: structure, campaign, ad set, ad, status. Không bao giờ chứa ad account, pixel, page hay landing page. |
| Setup | Phần chọn riêng cho từng lần launch: ad account, pixel, page, landing page URL, display link, URL parameters. |
| CBO / ABO | Budget nằm ở campaign / budget nằm ở từng ad set. |
| Mirror | Bản sao trong DB của node vừa tạo trên Meta, cùng khoá với dữ liệu sync. |
| Demo account | Ad account giả (`raw.demo = true`). Dùng writer giả, không gọi Meta, để test toàn bộ luồng không cần token. |

## 3. Luồng người dùng

### 3.1 Điểm vào

- **Thư viện Creatives**: tick nhiều creative → "Launch ads" → hộp thoại Quick launch. Trong hộp thoại có "Customise in Ads Launcher" để chuyển sang wizard đầy đủ.
- **Trang sản phẩm**: giống thư viện, chỉ với creative của sản phẩm đó.
- **Tab Posts** (trong thư viện và trang sản phẩm): chọn post → "Launch ads".
- **Ads Manager → Create**: mở wizard ở tab mới, ad account được chọn sẵn.
- **Deep link**: `/ads-launcher?creatives=a,b&posts=123_456,789_012&preset=<id>&account=<id>`. Nếu đã có pool và account thì wizard mở thẳng bước Structure. Tham số URL chỉ dùng để khởi tạo, đọc xong thì xoá khỏi URL.

### 3.2 Wizard 4 bước

Bố cục: tiêu đề, ô chọn ad account và thanh bước nằm cố định ở trên; thân bước cuộn; nút Back / Next cố định bên dưới và không bao giờ che field.

**Bước 1. Setup** (Product · pixel · page · landing page)

- **Product**: nếu đến từ creative thì tự suy ra từ creative đầu tiên (hoặc post đầu tiên).
- **Pixel**: pixel của ad account (đã lọc theo quyền). Có đúng một thì tự chọn.
- **Facebook page**: có avatar của page. Có đúng một thì tự chọn.
- **Landing page**: một ô chọn duy nhất, liệt kê mọi trang của sản phẩm trên các store đang chạy, **nhóm theo domain** (tiêu đề nhóm là hostname, ghi chú "product not published" khi sản phẩm chưa publish trên store đó). Mỗi store có trang sản phẩm và các store page đã publish (advertorial). Chọn một trang thì tự điền store, URL và display link (hostname). URL vẫn sửa tay được. Cuối danh sách có "Custom URL" để gõ link bất kỳ.
- **Không có ô chọn domain riêng**: chọn landing page là đã biết domain.
- **URL parameters** (`url_tags`): mặc định là template của Meta (mục 9).
- Không cần landing page khi pool chỉ toàn post cũ (mỗi post giữ link riêng của nó).
- **Ghi nhớ theo từng user** (localStorage, debounce 300 ms): ad account, pixel, page, store, display link, URL parameters, preset. Không ghi nhớ: pool, copy sửa tay, campaign hoặc ad set có sẵn.

**Bước 2. Creatives** (pool)

- Tab **Creatives**: creative của sản phẩm, mới nhất trước, bộ lọc "Not launched (n) / All" (mặc định Not launched), nút "Select all shown", hiện số thứ tự chọn trên mỗi item.
- Tab **Posts**: các post đã chạy của creative thuộc sản phẩm này.
- **Add by post ID**: dán bất kỳ post ID nào (`123_456`).
- Mỗi creative hiện như một ad Facebook trên điện thoại (preview có page, copy, media, nút CTA).

**Bước 3. Structure** (Preset · campaigns · ad sets)

- Danh sách preset dạng thẻ: tên, sơ đồ mini `C:S:A`, budget, bid strategy.
- Form preset sửa trực tiếp, sửa xong hiện nhãn "Modified", có "Save to preset" và "Save as new".
- **Đích**: campaign mới, hoặc campaign có sẵn (tuỳ chọn thêm ad set có sẵn).
- **Sơ đồ ngang** Campaign → Ad sets → Ads với thumbnail, budget, audience, bid. Bút chì trên từng ad set để chọn lại creative cho riêng ad set đó.
- Danh sách lỗi chặn (issues) hiện ngay dưới sơ đồ, nút Next bị khoá khi còn lỗi.

**Bước 4. Review & launch**

- Bảng "What will be launched": ad account (act id, nhãn demo), page (avatar), pixel (cảnh báo nếu tối ưu conversion mà chưa có pixel), pool dạng thumbnail, campaign (tên, objective, budget, bid), từng ad set (quốc gia, tuổi, giới tính, placements, tối ưu), ad (CTA, trạng thái, link, display link, URL tags). Mỗi dòng có nút Edit nhảy về bước tương ứng.
- Sửa copy từng creative (primary text, headline, description) cạnh preview Facebook cập nhật theo từng phím gõ. Ô để trống = dùng copy gốc của creative. Post cũ không sửa copy được.
- Start time (để trống = chạy ngay).
- Chọn trạng thái ACTIVE phải xác nhận thêm một lần.
- Bấm Launch: gửi từng campaign một, có thanh tiến trình, kết quả từng campaign / ad set / ad, nút "Open in Ads Manager", nút "Launch more" (giữ nguyên setup).
- Trong lúc đang gửi, mọi thao tác sửa đều bị khoá.

### 3.3 Hộp thoại Quick launch

Thứ tự: preset → ad account → pixel → page → landing page → sơ đồ kế hoạch → Launch (thanh tiến trình và kết quả từng campaign). Setup được điền từ bộ nhớ của user. Mỗi lần launch chỉ một sản phẩm.

## 4. Mô hình dữ liệu

Mọi bảng nghiệp vụ có `workspace_id` (multi-tenant), `created_at`, `updated_at`, `deleted_at` (xoá mềm). Thời gian lưu UTC.

### 4.1 Bảng mới

**`creatives`**

| Cột | Kiểu | Ghi chú |
| --- | --- | --- |
| id | uuid | khoá chính |
| workspace_id | uuid | |
| product_id | uuid | sản phẩm creative bán |
| media_file_id | uuid | file ảnh/video đã upload |
| created_by | uuid | người tạo (tên đi vào tên creative) |
| name | varchar(500) | sinh tự động, không gõ tay |
| angle | varchar(255) | ký tự `\|` đổi thành `/` khi lưu |
| product_code | varchar(64) | chụp lại mã sản phẩm lúc tạo |
| primary_text | text null | |
| headline | varchar(255) null | |
| description | varchar(255) null | |
| status | varchar(20) | `active` hoặc `archived`; chỉ `active` mới launch được |

Index: `(workspace_id, product_id, deleted_at)`, `(workspace_id, created_by, deleted_at)`, `(workspace_id, created_at desc)`.

Tên creative: `<tên người tạo> | <angle> | <mã sản phẩm> - <dd/MM/yyyy>`, ví dụ `Triết | Dead corner fix | SINLTB071SHNA - 25/04/2026`. Người dùng chỉ nhập angle; tên đầy đủ hiện trực tiếp phía trên ô nhập.

**`launch_presets`**

| Cột | Kiểu | Ghi chú |
| --- | --- | --- |
| id | uuid | |
| workspace_id, user_id | uuid | preset luôn là của riêng từng user |
| name | varchar(80) | |
| description | text | |
| config | jsonb | `LaunchPresetConfig` (mục 6), parse lại bằng schema khi đọc và khi ghi |
| starter_key | varchar(64) null | đánh dấu preset mẫu được copy cho user |
| position | int | thứ tự hiển thị |

Ràng buộc: unique `(workspace_id, user_id, starter_key)`, index `(workspace_id, user_id)`.

### 4.2 Cột thêm vào bảng có sẵn

Bảng `ads` (bản sao ad của Meta, đã có từ phần sync):

| Cột | Kiểu | Ghi chú |
| --- | --- | --- |
| creative_id | uuid null, FK → creatives (ON DELETE SET NULL) | liên kết duy nhất giữa ad và creative thư viện |
| post_id | varchar(100) null | `effective_object_story_id` |
| post_checked_at | timestamptz null | lần cuối hỏi Meta post ID của ad này |

Index: `(creative_id)`, `(workspace_id, post_id)`.

Các bảng `campaigns`, `ad_sets`, `ads` đã có unique `(workspace_id, external_id)`. Launcher upsert theo đúng khoá này nên lần sync sau gộp được, không sinh bản trùng. `ad_sets.bid_strategy` lưu chiến lược bid; `campaigns.raw.bid_strategy` lưu chiến lược của campaign (sync phải lấy thêm trường `bid_strategy` của campaign).

Migration chỉ thêm (additive): thêm bảng, thêm cột nullable, thêm index. Không xoá hay đổi kiểu cột nào.

### 4.3 Lưu file media

- Ảnh lưu WebP (kèm thumbnail). Khi đẩy lên Meta thì chuyển sang JPEG.
- Video giữ nguyên file gốc (không transcode, Meta tự transcode), chỉ trích một frame làm poster (dùng làm thumbnail cho ad video).
- File phải truy cập được qua URL công khai HTTPS (Meta tải video bằng URL).

## 5. Cấu trúc `C:S:A` và thuật toán chia

### 5.1 Quy tắc

`C` campaign · `S` ad set mỗi campaign · `A` ad mỗi ad set. Mỗi cấp là số (1 đến 50) hoặc `n`. **`n` chỉ được xuất hiện ở một cấp.** Với N item trong pool (theo thứ tự chọn, đã bỏ trùng):

| Mẫu | Ý nghĩa |
| --- | --- |
| `c:s:n` | Mỗi ad set chứa tất cả item; có `c` bản campaign × `s` bản ad set. |
| `c:n:k` | Chia item thành nhóm `k`, mỗi nhóm một ad set, lặp trong `c` bản campaign. |
| `n:s:k` | Mỗi campaign nhận `s×k` item, chia `k` item mỗi ad set. |
| `c:s:k` | Đúng `c×s×k` ô, chia lần lượt. Ít item hơn số ô thì quay vòng; nhiều hơn thì phần thừa bị bỏ ra (`leftOut`) và chặn launch. |

**Repeat to fill** (`repeatToFill`, mặc định bật, kể cả với preset cũ chưa có trường này): khi `A` là số `k`, mỗi ad set có đúng `k` ad; ad set nào nhận ít item hơn thì lặp lại các item của nó theo thứ tự. Tắt đi thì một ad set không bao giờ chứa một item hai lần và nhóm thiếu cứ để thiếu. Không có tác dụng khi `A = n`.

Audience: preset có 1 đến 10 audience; ad set thứ `i` lấy audience `i mod số audience`.

### 5.2 Ví dụ

| Cấu trúc | Pool | Kết quả (campaign · ad set · ad) |
| --- | --- | --- |
| `1:1:n` | 6 creative | 1 · 1 · 6 |
| `1:3:n` | 6 | 1 · 3 · 18 |
| `3:1:n` | 6 | 3 · 3 · 18 |
| `1:n:1` | 6 | 1 · 6 · 6 |
| `1:n:3` | 6 | 1 · 2 · 6 |
| `1:n:3` | 4 (A,B,C,D), repeat bật | 1 · 2 · 6: `[A,B,C]`, `[D,D,D]` |
| `1:n:3` | 4, repeat tắt | 1 · 2 · 4: `[A,B,C]`, `[D]` |
| `n:1:1` | 6 | 6 · 6 · 6 |
| `n:2:1` | 6 | 3 · 6 · 6 |
| `n:2:2` | 5, repeat bật | 2 · 4 · 8: `[[A,B],[C,D]]`, `[[E,E],[E,E]]` |
| `1:1:3` | 1 creative, repeat bật | 1 · 1 · 3: ba ad cùng creative, tên `A #1`, `A #2`, `A #3` |
| `1:1:3` | 1 creative, repeat tắt | 1 · 1 · 1 |
| `1:3:2` | 4 creative | 1 · 3 · 6: `[A,B]`, `[C,D]`, `[A,B]` (quay vòng) |
| `1:2:2` | 6 creative | lỗi: 4 ô cho 6 creative, phải dùng `n` hoặc bớt creative |

### 5.3 Thuật toán (TypeScript, thuần, không phụ thuộc gì)

```ts
type Count = number | 'n';
interface Structure { campaigns: Count; adsetsPerCampaign: Count; adsPerAdset: Count; repeatToFill?: boolean }

const range = (n: number) => Array.from({ length: Math.max(0, n) }, (_, i) => i);
const chunk = <T>(xs: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += Math.max(1, size)) out.push(xs.slice(i, i + Math.max(1, size)));
  return out;
};
const unique = <T>(xs: T[]) => [...new Set(xs)];
const num = (c: Count) => (c === 'n' ? 1 : c);

/** Lặp xs theo thứ tự cho đến khi đủ k phần tử; đủ rồi thì giữ nguyên. */
export const fillTo = <T>(xs: T[], k: number): T[] =>
  xs.length === 0 || xs.length >= k ? [...xs] : range(k).map((i) => xs[i % xs.length]!);

/** grid[campaign][adset] = danh sách item id (mỗi id là một ad). */
export const resolveStructure = (s: Structure, itemIds: string[]) => {
  const ids = unique(itemIds);
  if (ids.length === 0) return { grid: [] as string[][][], leftOut: [] as string[] };
  const { campaigns: C, adsetsPerCampaign: S, adsPerAdset: A } = s;
  const repeat = s.repeatToFill !== false;

  if (A === 'n') return { grid: range(num(C)).map(() => range(num(S)).map(() => [...ids])), leftOut: [] };
  if (S === 'n') {
    const groups = chunk(ids, A).map((g) => (repeat ? fillTo(g, A) : g));
    return { grid: range(num(C)).map(() => groups.map((g) => [...g])), leftOut: [] };
  }
  if (C === 'n') {
    return {
      grid: chunk(ids, S * A).map((share) => chunk(repeat ? fillTo(share, S * A) : share, A)),
      leftOut: [],
    };
  }
  const slots = C * S * A;
  const used = ids.slice(0, slots);
  const grid = range(C).map((c) =>
    range(S).map((si) => {
      const dealt = range(A).map((a) => used[(c * S * A + si * A + a) % used.length]!);
      return repeat ? dealt : unique(dealt);
    }),
  );
  return { grid, leftOut: ids.slice(slots) };
};
```

Ad set được sửa tay (chọn lại creative từ sơ đồ) cũng được lấp đầy bằng `fillTo` như ad set được chia tự động. Sửa tay lưu theo khoá `"<campaignIndex>:<adsetIndex>"`.

### 5.4 Đặt tên

- Tên campaign từ template, token: `{product} {code} {preset} {structure} {date} {n} {angle}`. `{structure}` là `1-n-1`; `{date}` là `DD/MM` theo múi giờ hệ thống; `{n}` là số thứ tự campaign; `{angle}` là angle của item đầu tiên, thêm `+2` nếu có thêm 2 item khác.
- Tên ad set từ template, token: `{campaign} {n} {audience} {country} {age} {gender} {angle}`.
- Token không biết thì giữ nguyên chữ. Sau khi điền: bỏ dấu phân cách bị thừa do token rỗng (`|`, `·`, `-` đứng liền nhau hoặc ở đầu/cuối), gộp khoảng trắng, cắt còn 255 ký tự.
- Nếu nhiều campaign (hoặc ad set) ra cùng tên và template không có `{n}` thì thêm ` #1`, ` #2`...
- Tên ad = tên creative (post cũ: tên creative gốc nếu có, không thì `Post <postId>`). Trong một ad set, tên nào lặp thì đánh số ` #1`, ` #2` theo thứ tự (phía server làm), tên xuất hiện một lần giữ nguyên.

### 5.5 Lỗi chặn launch (issues)

- Chưa chọn item nào.
- Cấu trúc cố định có ít ô hơn số item (`leftOut`).
- Quá 50 campaign mỗi lần launch; quá 50 ad set mỗi campaign; quá 50 ad mỗi ad set; quá 200 ad mỗi campaign.
- Preset không có audience nào.
- Lỗi của chính preset (budget, tuổi, bid...) chuyển thành câu dễ đọc: `Campaign · bidAmount: Set the amount for this bid strategy`.
- Lỗi setup: chưa chọn account; tối ưu theo pixel mà chưa có pixel; pixel/page không phải số; thiếu landing page khi có ad từ creative; URL parameters dài quá 1024 ký tự.
- Đích là campaign có sẵn: chưa chọn campaign; cấu trúc có hơn 1 campaign; chọn ad set có sẵn mà cấu trúc có hơn 1 ad set; campaign có sẵn đang bid kiểu cần số tiền / ROAS mà preset bid kiểu khác (mục 8.4).

## 6. Preset

### 6.1 Cấu hình

```ts
LaunchPresetConfig = {
  structure: { campaigns: number | 'n', adsetsPerCampaign: number | 'n', adsPerAdset: number | 'n', repeatToFill?: boolean },
  campaign: {
    nameTemplate: string,                      // 1..255
    objective: 'OUTCOME_SALES' | 'OUTCOME_LEADS' | 'OUTCOME_TRAFFIC' | 'OUTCOME_ENGAGEMENT' | 'OUTCOME_AWARENESS',
    budgetMode: 'CBO' | 'ABO',
    dailyBudget: string,                       // đơn vị lớn: "50", "12.50"; CBO = mỗi campaign, ABO = mỗi ad set
    bidStrategy?: 'LOWEST_COST_WITHOUT_CAP' | 'COST_CAP' | 'LOWEST_COST_WITH_BID_CAP' | 'LOWEST_COST_WITH_MIN_ROAS',
    bidAmount?: string,                        // cost cap / bid cap, đơn vị lớn, áp cho mọi ad set
    roasGoal?: string,                         // ROAS tối thiểu "1.5", từ 0.01 đến 1000, tối đa 3 số lẻ
  },
  adset: {
    nameTemplate: string,
    optimizationGoal: 'OFFSITE_CONVERSIONS' | 'VALUE' | 'LINK_CLICKS' | 'LANDING_PAGE_VIEWS' | 'IMPRESSIONS' | 'REACH',
    conversionEvent: 'PURCHASE' | 'ADD_TO_CART' | 'INITIATE_CHECKOUT' | 'LEAD' | 'COMPLETE_REGISTRATION',
    advantagePlacements: boolean,
    audiences: Array<{ label: string, countries: string[] /* ISO-2, 1..50 */, ageMin: number, ageMax: number /* 13..65 */, gender: 'all' | 'men' | 'women' }>, // 1..10
  },
  ad: { callToAction: 'SHOP_NOW' | 'LEARN_MORE' | 'ORDER_NOW' | 'BUY_NOW' | 'GET_OFFER' | 'SIGN_UP' | 'SUBSCRIBE' | 'CONTACT_US' },
  status: 'PAUSED' | 'ACTIVE',                 // trạng thái của mọi thứ được tạo
}
```

Ràng buộc:

- `n` chỉ ở một cấp của structure.
- `ageMin <= ageMax`.
- `COST_CAP` và `LOWEST_COST_WITH_BID_CAP` bắt buộc `bidAmount`.
- `LOWEST_COST_WITH_MIN_ROAS` bắt buộc `roasGoal` và `optimizationGoal = 'VALUE'`.
- Tiền là chuỗi thập phân đơn vị lớn (regex `^\d+(\.\d{1,2})?$`, lớn hơn 0), không bao giờ là số float.

Tên hiển thị của bid strategy (theo chữ của Ads Manager): Highest volume (với VALUE thì là Highest value), Cost per result goal, Bid cap, ROAS goal.

### 6.2 Preset mẫu

Lần đầu user mở danh sách preset (chưa có dòng nào, kể cả dòng đã xoá) thì copy preset mẫu vào cho user. Sau đó là của user, sửa hay xoá tuỳ ý. Có nút "Restore starters" để thêm lại preset mẫu bị thiếu và hồi phục preset mẫu đã xoá.

Bản Adlux hiện có 2 preset mẫu (đều Sales, tối ưu Purchase, US, 18 đến 65, Advantage+ placements, Shop now, Paused):

| Key | Tên | Structure | Budget | Template tên campaign |
| --- | --- | --- | --- | --- |
| `cbo-all-in-one` | CBO all-in-one | `1:1:n` | CBO 50 | `{code} \| CBO \| {date}` |
| `cbo-per-creative` | CBO per creative | `n:1:1` | CBO 30 | `{code} \| {angle} \| {date}` |

Template tên ad set: `{campaign} | {audience}`.

Gợi ý thêm cho dự án mới (các cấu trúc media buyer hay dùng): `1:n:1` ABO test từng creative; `1:n:3` ABO mỗi concept 3 creative; `3:1:n` nhân 3 campaign CBO giống nhau; `1:3:n` ABO tách 3 audience.

## 7. API

Mọi endpoint cần đăng nhập. Body và query parse bằng zod ngay ở route; sai thì trả 400. Phản hồi thành công `{ success: true, data }`, lỗi `{ success: false, error: { code, message, details? } }`.

### 7.1 `GET /api/ads-launcher/options?adAccountId=<uuid>`

Quyền `ads_launcher.use` và quyền ghi trên ad account. Trả dữ liệu cho các ô chọn:

```json
{
  "adAccount": { "id": "uuid", "externalId": "1234567890", "name": "Shop US", "currency": "USD", "isDemo": false },
  "pages":  [{ "externalId": "1000000001", "name": "My Page" }],
  "pixels": [{ "externalId": "2000000002", "name": "Main pixel" }],
  "campaigns": [{
    "id": "uuid", "externalId": "120200000001", "name": "Comb | CBO | 05/10",
    "status": "ACTIVE", "objective": "OUTCOME_SALES", "dailyBudget": "5000",
    "bidStrategy": "COST_CAP",
    "adsets": [{ "id": "uuid", "externalId": "120200000002", "name": "...", "status": "ACTIVE", "dailyBudget": null }]
  }]
}
```

Page và pixel lọc theo người xem (mục 11).

### 7.2 `GET /api/ads-launcher/stores?productIds=a,b`

Các store đang chạy có bán ít nhất một sản phẩm được hỏi, kèm landing page. Lọc theo store người xem được phép (mục 11).

```json
{ "items": [{
  "storeId": "uuid", "hostname": "shop-a.com",
  "products": [{ "productId": "uuid", "url": "https://shop-a.com/products/comb", "listingStatus": "active" }],
  "pages": [{ "id": "uuid", "title": "Advertorial", "url": "https://shop-a.com/pages/story", "productId": "uuid" }]
}]}
```

Sản phẩm clone được quy về sản phẩm gốc (master) mà client hỏi.

### 7.3 `POST /api/ads-launcher/launch`

Một request = **một campaign** (mới hoặc có sẵn) × N ad set (mới hoặc có sẵn), mỗi ad set có nhóm ad riêng. Client gửi lần lượt từng campaign.

**Request**

```json
{
  "adAccountId": "uuid",
  "pageId": "1000000001",
  "pixelId": "2000000002",
  "campaign": {
    "mode": "new", "name": "COMB | CBO | 07/10", "objective": "OUTCOME_SALES",
    "dailyBudget": "50", "bidStrategy": "COST_CAP", "status": "PAUSED"
  },
  "adsets": [{
    "mode": "new", "name": "COMB | CBO | 07/10 | Broad",
    "bidAmount": "25",
    "optimizationGoal": "OFFSITE_CONVERSIONS", "conversionEvent": "PURCHASE",
    "pixelId": "2000000002",
    "targeting": { "countries": ["US"], "ageMin": 18, "ageMax": 65, "genders": [], "advantagePlacements": true },
    "status": "PAUSED",
    "ads": [
      { "creativeId": "c1-uuid" },
      { "creativeId": "c1-uuid" },
      { "creativeId": "c1-uuid", "primaryText": "Copy riêng cho ad này" },
      { "postId": "1000000001_555555555", "creativeId": "c2-uuid" }
    ]
  }],
  "ads": [],
  "destination": { "url": "https://shop-a.com/products/comb", "displayLink": "shop-a.com" },
  "callToAction": "SHOP_NOW",
  "urlTags": "utm_source={{campaign.name}}&utm_medium={{adset.name}}&utm_campaign={{ad.name}}&utm_content={{ad.id}}",
  "adStatus": "PAUSED",
  "requestId": "uuid mới cho mỗi request",
  "launchId": "uuid chung cho cả lần launch"
}
```

**Quy tắc của request**

- `campaign`: `{ mode: 'existing', campaignId }` hoặc `{ mode: 'new', name, objective, dailyBudget?, bidStrategy?, status }`. Có `dailyBudget` = CBO.
- `adsets[]` (1 đến 50): `{ mode: 'existing', adsetId, ads? }` hoặc `{ mode: 'new', name, dailyBudget?, bidStrategy?, bidAmount?, roasGoal?, optimizationGoal, conversionEvent, pixelId?, targeting, status, startTime?, ads? }`.
- `adsets[i].ads` (1 đến 50) là nhóm ad riêng của ad set; bỏ trống thì dùng `ads` chung của request.
- Mỗi ad (`LaunchAdSpec`): cần `creativeId` hoặc `postId` (hoặc cả hai). Có `postId` thì không được gửi `headline`, `primaryText`, `description`, `link` (post giữ nội dung của nó); `creativeId` đi kèm post chỉ để liên kết analytics. Ad từ creative có thể ghi đè copy, `name`, `link` riêng.
- `postId` khớp regex `^\d{3,}_\d{3,}$`.
- `targeting.genders`: `[]` = tất cả, `[1]` = nam, `[2]` = nữ (mã của Meta).
- Mỗi ad set phải có ít nhất 1 ad; tổng ad mỗi request tối đa 200.
- `destination` bắt buộc khi có ít nhất một ad làm từ creative; launch toàn post cũ thì không cần.
- Bid: bên nào giữ strategy (campaign nếu CBO, ad set nếu ABO) quyết định ad set mới phải mang gì: strategy cần số tiền thì ad set phải có `bidAmount`; ROAS goal thì ad set phải có `roasGoal` và `optimizationGoal = 'VALUE'`.
- `requestId`: khoá idempotency, mỗi request một uuid mới. `launchId`: một uuid cho cả lần launch (mọi campaign), dùng để chia sẻ media và Meta creative giữa các request.

**Response**

```json
{
  "campaign": { "status": "ok", "id": "uuid", "externalId": "1202...", "name": "..." },
  "adsets": [{
    "status": "ok", "id": "uuid", "externalId": "1202...", "name": "...",
    "ads": [
      { "status": "ok", "id": "uuid", "externalId": "1202...", "name": "Creative A #1", "creativeId": "c1-uuid" },
      { "status": "failed", "name": "Creative A #2", "error": "Lời nhắn của Meta", "creativeId": "c1-uuid" },
      { "status": "ok", "externalId": "1202...", "name": "Post 1000000001_555555555", "creativeId": "c2-uuid",
        "postId": "1000000001_555555555", "warning": "Created on Meta but not saved locally yet. The next sync will pick it up." }
    ]
  }],
  "summary": { "adsCreated": 2, "adsFailed": 1, "adsetsCreated": 1, "campaignCreated": true }
}
```

- `status` từng item: `ok`, `failed`, `skipped` (bỏ qua vì cha bị lỗi).
- `warning`: đã tạo trên Meta nhưng ghi DB lỗi. Vẫn là `ok` để client không thử lại và tạo trùng.
- Mã HTTP: 201 khi campaign tạo được; 200 khi campaign lỗi (vẫn là kết quả đầy đủ); 409 khi cùng `requestId` đang chạy; 403 khi không có quyền với ad account hoặc không có token Facebook nào với tới account; 404 khi creative không thấy, đã archive hoặc ngoài phạm vi; 400 khi sai dữ liệu; 502 khi circuit breaker của Meta đang mở.

### 7.4 `GET /api/ads-launcher/posts`

Một dòng cho mỗi post, gộp mọi ad đang chạy post đó, trong các ad account người xem thấy được.

Query: `q` (tên ad, post ID, tên hoặc angle creative, copy), `productId`, `creativeId`, `adAccountId`, `status` (`active` = có ít nhất 1 ad đang chạy | `all`), `source` (`library` = chỉ ad làm từ creative thư viện | `all`), `range` (`7d` | `30d` | `90d` | `lifetime`, mặc định `30d`, tính theo ngày ở múi giờ hệ thống, gồm hôm nay), `sort` (`spend` | `purchases` | `roas` | `recent`), `postIds` (tối đa 100, tra theo id), `page`, `pageSize` (tối đa 100).

Mỗi dòng: `postId`, `pageId`, `pageName`, `permalink` (`https://www.facebook.com/<pageId>/posts/<storyId>`), `thumbnailUrl` (poster của creative thư viện, không có thì thumbnail Meta), `isVideo`, `headline`, `primaryText`, `link`, `creative {id, name, angle}`, `product {id, title, handle, code, imageUrl}`, `ads`, `activeAds`, `adAccounts[]`, `lastAd {id, name, campaignName, effectiveStatus}`, `firstUsedAt`, `lastUsedAt`, `currency` (null nếu các account khác tiền tệ), `metrics {spend, impressions, clicks, purchases, revenue, roas, cpa}`.

Kèm theo: `total`, `hasMore`, `range {from, to}` và `missingPostIds` (số ad trong phạm vi lọc chưa có post ID, chính là việc nút "Refresh post IDs" sẽ làm).

### 7.5 `POST /api/ads-launcher/posts/refresh`

Body `{ adAccountId?, productId?, creativeId? }`. Hỏi Meta post ID cho các ad chưa có. Trả `{ checked, found, remaining, failures: [{ adAccountId, name, error }] }`. Thuật toán ở mục 10.1.

### 7.6 `/api/launch-presets` (quyền `ads_launcher.use`, luôn chỉ dòng của chính người gọi)

- `GET /`: danh sách; lần đầu thì copy preset mẫu (dùng `createMany` + `skipDuplicates` theo unique starter key).
- `POST /`: tạo `{ name, description, config }`.
- `PUT /:id`: sửa.
- `DELETE /:id`: xoá mềm.
- `POST /restore-starters`: thêm lại preset mẫu thiếu, hồi phục preset mẫu đã xoá, sửa preset mẫu có config không còn parse được.

Dòng có config không còn hợp lệ với schema thì bỏ qua và ghi log, không làm hỏng cả danh sách.

## 8. Backend: xử lý một request launch

### 8.1 Ở route

1. Kiểm tra đăng nhập, quyền `ads_launcher.use`, parse body bằng zod.
2. **Quyền ghi ad account**: người gọi có dòng `ad_account_access` trên account (trong workspace của họ), hoặc có quyền admin `ads_manager.view_all_users`. Không thì 403.
3. **Phạm vi creative** của người gọi: `null` với admin và người có `creatives.view_all`, còn lại là danh sách product id (mục 11).
4. **Idempotency** (Redis): `SET ads-launcher:launch:<workspaceId>:<requestId> {"status":"running"} EX 86400 NX`.
   - Ghi được: chạy launch.
   - Đã có và `done`: trả lại kết quả đã lưu, không tạo gì thêm.
   - Đã có và `running`: 409.
   - Redis lỗi: vẫn launch (chỉ mất khả năng replay), không bao giờ từ chối vì Redis.
   - Launch ném lỗi: xoá key để lần thử lại đã sửa không bị 409.
   - Xong: lưu `{status:"done", result}` 24 giờ.
5. **Chọn writer**:
   - Account demo → `FakeMetaAdsWriter` (trả id số giả, không gọi mạng).
   - Account thật → tìm token: ưu tiên người gọi, sau đó bất kỳ ai có quyền với account; mỗi người lấy Meta App của họ rồi lấy token. Không có token nào thì 403 "Connect Facebook first".
   - Circuit breaker của Meta App đang mở (token hết hạn, app bị chặn, rate limit) thì 502 ngay, không gọi Meta.
6. Nếu có `launchId` thì tạo asset cache Redis cho lần launch này (mục 8.6).

### 8.2 Use case `LaunchAds` (từng bước)

1. Gom ad của từng ad set: `adset.ads ?? request.ads`.
2. Có ad từ creative mà không có `destination` → 400.
3. **Nạp creative**: đúng workspace, chưa xoá, trong phạm vi sản phẩm của người gọi. Thiếu id nào → 404 `Creative not found`. Có creative `archived` → 404 kèm lời nhắn "restore it in the library before launching".
4. **Nạp creative gốc của post** (`creativeId` đi kèm `postId`): trạng thái nào cũng được (post của creative đã archive vẫn chạy được); không thấy hoặc ngoài phạm vi thì chỉ bỏ liên kết, post vẫn chạy.
5. **Lập kế hoạch từng ad**:
   - Ad từ creative: tên = `name` hoặc tên creative; copy = giá trị ghi đè hoặc copy của creative (trống thì chuỗi rỗng); link = `link` riêng hoặc `destination.url`.
   - Khoá dùng chung Meta creative (`creativeKey`) = JSON ổn định của `{creativeId, pageId, link, displayLink, callToAction, urlTags, copy}`. Các ad trùng khoá (thường là cùng creative ở nhiều ad set, hoặc lặp trong một ad set) dùng **một** Meta creative.
   - Ad từ post: khoá = JSON `{post, urlTags}`; tên = `name`, hoặc tên creative gốc, hoặc `Post <postId>`.
   - Đánh số tên lặp trong từng ad set: `[A, A, B, A]` → `[A #1, A #2, B, A #3]`.
6. **Campaign**:
   - Có sẵn: tìm trong account (chưa xoá). CBO nếu có daily hoặc lifetime budget. Bid strategy đọc từ `raw.bid_strategy` đã sync (chỉ nhận giá trị trong danh sách đã biết).
   - Mới: tạo trên Meta, rồi mirror (upsert theo `(workspace_id, external_id)`, `raw` có `launched_by: "ads-launcher"`, `bid_strategy`, `demo: true` nếu là account demo).
   - Lỗi ở bước này: trả campaign `failed`, mọi ad set và ad `skipped`, dừng.
7. **Media**: mỗi creative upload một lần cho cả request (và cho cả lần launch, nhờ cache).
   - Ảnh: đọc file, xoay theo EXIF, nền trắng, JPEG chất lượng 92, gửi base64 lên `adimages` → `image_hash`.
   - Video: gửi `file_url` (URL công khai) lên `advideos` → `video_id`; hỏi trạng thái tối đa 10 lần, mỗi lần cách 3 giây (`ready` thì dừng, `error` thì báo lỗi); upload poster làm thumbnail → `image_hash`.
   - Video mà không có URL công khai HTTPS → lỗi "Video upload needs PUBLIC_ASSET_BASE_URL". Không có poster → lỗi.
   - Upload lỗi chỉ làm hỏng các ad dùng creative đó.
8. **Meta creative**: mỗi khoá khác nhau một creative.
   - Có trong cache của lần launch thì dùng lại.
   - Còn lại tạo trong **một batch** (50 thao tác mỗi HTTP request). Thao tác lỗi chỉ làm hỏng các ad cần nó.
   - Đọc lại `effective_object_story_id` của các creative mới trong một batch GET (best effort: lỗi thì để lần sync sau điền). Post cũ thì biết post ID ngay.
   - Ghi cache `{id, postId}`.
9. **Từng ad set**:
   - Có sẵn: tìm trong campaign. Không thấy → ad set `failed`, ad của nó `skipped`, sang ad set tiếp.
   - Mới: ABO thì bắt buộc có `dailyBudget`; mục tiêu tối ưu theo pixel (`OFFSITE_CONVERSIONS`, `VALUE`) thì bắt buộc có pixel (`adset.pixelId ?? request.pixelId`); kiểm tra bid (mục 8.4); tạo trên Meta; mirror. Vi phạm điều kiện nào thì ad set đó `failed` kèm lý do, ad của nó `skipped`.
   - Tạo mọi ad của ad set trong một batch. Ad nào mà Meta creative của nó lỗi thì `failed` với đúng lỗi đó.
   - Mỗi ad tạo xong thì mirror ngay: `creative_id` (creative thư viện), `post_id`, `name`, `status`, `link`, `display_link`, `url_tags`, `title`, `body`, `thumbnail_url`, `image_url`, `call_to_action_type`, `creative_data` (kèm `library_creative_id`, `object_story_id`, `effective_object_story_id`). Với post cũ, hình và chữ mượn từ ad mới nhất đang chạy post đó, không có thì lấy từ creative gốc.
10. Trả kết quả từng item và `summary`.

**Nguyên tắc quan trọng nhất**: ghi lên Meta không rollback được. Khi một node đã có id trên Meta, lỗi ghi DB **không bao giờ** được báo là `failed` (client sẽ thử lại và tạo trùng). Báo `ok` kèm `externalId` và `warning`, ghi log mức error, để lần sync sau gộp lại. Một item lỗi không bao giờ làm dừng các item anh em của nó.

### 8.3 Trường gửi lên Meta

Tất cả là `POST https://graph.facebook.com/v23.0/act_<adAccountId>/<edge>`, body dạng form urlencoded; giá trị object/array gửi dưới dạng chuỗi JSON. Tiền gửi theo đơn vị nhỏ (cent), đổi bằng chuỗi và BigInt: `"12.50"` → `"1250"`, không dùng float.

| Edge | Trường |
| --- | --- |
| `campaigns` | `name`, `objective`, `status`, `special_ad_categories=[]`, `buying_type=AUCTION`; nếu CBO thêm `daily_budget`, `bid_strategy` |
| `adsets` | `name`, `campaign_id`, `status`, `billing_event=IMPRESSIONS`, `optimization_goal`, `targeting`; nếu ABO thêm `daily_budget`, `bid_strategy`; thêm `bid_amount` khi cần (không bao giờ kèm ROAS goal); thêm `bid_constraints {roas_average_floor}` khi ROAS goal; `promoted_object {pixel_id, custom_event_type}` khi tối ưu theo pixel (VALUE luôn dùng `PURCHASE`); `start_time` nếu có |
| `adimages` | `bytes` (JPEG base64), `name` → `images.<tên>.hash` |
| `advideos` | `file_url`, `name` → `id`; sau đó `GET <videoId>?fields=status` để xem `status.video_status` |
| `adcreatives` (ảnh) | `name`, `url_tags`, `object_story_spec { page_id, link_data { link, image_hash, message, name, description, caption?, call_to_action { type, value { link } } } }` |
| `adcreatives` (video) | `name`, `url_tags`, `object_story_spec { page_id, video_data { video_id, image_hash, title, message, link_description, call_to_action { type, value { link } } } }` |
| `adcreatives` (post cũ) | `name`, `object_story_id=<pageId>_<postId>`, `url_tags` |
| `ads` | `name`, `adset_id`, `creative { creative_id }`, `status` |

Trong `link_data`: `message` = primary text, `name` = headline, `description` = description, `caption` = display link. Trong `video_data`: `title` = headline, `message` = primary text, `link_description` = description.

`targeting`:

```json
{
  "geo_locations": { "countries": ["US"] },
  "age_min": 18, "age_max": 65,
  "genders": [1],
  "targeting_automation": { "advantage_audience": 1 },
  "publisher_platforms": ["facebook", "instagram"],
  "facebook_positions": ["feed", "story", "facebook_reels"],
  "instagram_positions": ["stream", "story", "reels"]
}
```

- `genders` chỉ gửi khi chọn đúng một giới.
- `targeting_automation.advantage_audience = 1` luôn gửi (Meta từ chối ad set Sales mới thiếu trường này).
- Ba trường placements chỉ gửi khi **tắt** Advantage+ placements.

**Batch** (dùng cho tạo creative, tạo ad, đọc post ID): `POST https://graph.facebook.com/v23.0/` với form `access_token`, `include_headers=false`, `batch=[{"method":"POST","relative_url":"act_<id>/adcreatives","body":"<form urlencoded của trường>"}]`. Tối đa 50 thao tác mỗi request. Mỗi phần tử trả về `{code, body}` với `body` là chuỗi JSON: `code` 2xx và có `id` là thành công; còn lại lấy `error.error_user_msg` hoặc `error.message`; phần tử `null` nghĩa là Meta bỏ dở. Batch hỏng cả request thì chỉ các thao tác của batch đó lỗi; batch trước đã tạo vẫn được tính là đã tạo.

**Đọc post ID**: `GET <creativeId>?fields=effective_object_story_id` (sau khi tạo creative), `GET <adId>?fields=creative{effective_object_story_id}` (khi refresh).

**Sửa copy ad có sẵn** (bulk edit trong Ads Manager): đọc `GET <adId>?fields=creative{id,object_story_spec,url_tags}`, thay ba trường copy trong `link_data` hoặc `video_data`, tạo creative mới từ spec đó, rồi `POST <adId>` với `creative={"creative_id":"<id mới>"}`. Spec không có `link_data` lẫn `video_data` (ad dynamic/catalog) thì báo "không sửa được", không tạo gì.

### 8.4 Bid strategy theo CBO và ABO

| Trường hợp | Campaign gửi | Ad set mới gửi |
| --- | --- | --- |
| CBO, Highest volume | `daily_budget`, `bid_strategy=LOWEST_COST_WITHOUT_CAP` | không gì về bid |
| CBO, Cost per result goal | `daily_budget`, `bid_strategy=COST_CAP` | `bid_amount` (cent) |
| CBO, Bid cap | `daily_budget`, `bid_strategy=LOWEST_COST_WITH_BID_CAP` | `bid_amount` (cent) |
| CBO, ROAS goal | `daily_budget`, `bid_strategy=LOWEST_COST_WITH_MIN_ROAS` | `bid_constraints.roas_average_floor` = ROAS × 10000 (1.8 → 18000), `optimization_goal=VALUE`, không gửi `bid_amount` |
| ABO (mọi strategy) | không budget, không `bid_strategy` | `daily_budget`, `bid_strategy`, và `bid_amount` hoặc `bid_constraints` như trên |

Campaign có sẵn:

- CBO và đã biết strategy (từ sync): ad set mới chỉ nhận số tiền / ROAS khi strategy của preset **trùng** với campaign. Campaign cần số tiền mà preset khác strategy thì web chặn với câu "<Campaign> bids with Cost per result goal: set the same bid strategy and its amount".
- CBO chưa biết strategy: gửi số tiền / ROAS mà request mang theo (web quyết định).
- ABO: ad set tự mang budget và strategy như campaign mới.

Server kiểm tra lại lần nữa: với campaign mới, schema từ chối ngay cả request (400) khi strategy cần số tiền mà thiếu, hoặc ROAS goal mà thiếu ROAS hay không tối ưu VALUE. Với campaign có sẵn, ad set vi phạm báo `failed` kèm lý do, các ad set khác vẫn chạy.

### 8.5 Số lệnh gọi Meta cho một campaign

Với A ad set, C creative khác nhau, D Meta creative khác nhau:

`1 (campaign) + A (ad set) + C (media, video thêm thumbnail và vài lần hỏi trạng thái) + ⌈D/50⌉ (tạo creative) + ⌈D/50⌉ (đọc post ID) + A × ⌈số ad mỗi ad set / 50⌉ (tạo ad)` request HTTP.

Mỗi thao tác trong batch vẫn tính một lần vào rate limit của Meta. Phần tiết kiệm thật nằm ở việc dùng chung creative (A×C → D) và cache media + creative giữa các campaign của cùng một lần launch; batch giúp nhanh hơn về thời gian.

### 8.6 Cache tài sản theo lần launch

- Key Redis: `ads-launcher:assets:<workspaceId>:<launchId>:<kind>:<hash>`, `kind` là `media` hoặc `creative`, TTL 24 giờ, giá trị JSON.
- Media: hash của `['media', externalAdAccountId, creativeId, storagePath]` → `{kind:'image', imageHash}` hoặc `{kind:'video', videoId, thumbnailHash}`.
- Creative: hash của `['creative', externalAdAccountId, creativeKey]` → `{id, postId?}`.
- Lỗi Redis chỉ ghi log và coi như cache trống (mất một lệnh gọi Meta, không mất cả lần launch).

## 9. Tracking và attribution

- `url_tags` mặc định (Meta tự điền khi phân phối): `utm_source={{campaign.name}}&utm_medium={{adset.name}}&utm_campaign={{ad.name}}&utm_content={{ad.id}}`.
- Đường liên kết creative → doanh thu: `utm_content` (id ad của Meta) → `ads.external_id` → `ads.creative_id` → creative. Đơn hàng gắn với ad qua bảng attribution; insights (spend, impressions, clicks) lấy theo id ad.
- Ad tạo ngoài launcher không có `creative_id`, nên không được tính cho creative nào (vẫn thấy trong tab Posts với `source = all`).

## 10. Dùng lại bài post cũ

### 10.1 Thu thập post ID (ba nguồn)

1. **Sync cấu trúc** từ Meta: thêm `effective_object_story_id` vào danh sách trường `creative{...}` của ad. Upsert chỉ ghi `post_id` khi Meta trả về, không bao giờ xoá giá trị đã có.
2. **Lúc launch**: đọc lại post của creative mới (mục 8.2 bước 8) và ghi vào ad được mirror. Post cũ thì biết ngay.
3. **Nút "Refresh post IDs"** (`POST /posts/refresh`):
   - Ứng viên: ad trong phạm vi (account người xem thấy, lọc thêm theo account / sản phẩm / creative nếu có), chưa có `post_id`, và chưa được hỏi trong 6 giờ qua (`post_checked_at` null hoặc cũ hơn). Mới nhất trước, tối đa 1000 ad mỗi lần bấm.
   - Gom theo ad account; mỗi account dùng đúng writer mà launch sẽ dùng (Meta thật, hoặc writer giả với account demo). Account không lấy được writer (không token, breaker mở) thì ghi vào `failures` và chuyển account khác.
   - Mỗi 50 ad một batch GET. Giá trị hợp lệ (khớp regex, tối đa 100 ký tự) thì ghi `post_id`. **Mọi** ad đã hỏi đều được đóng dấu `post_checked_at`, có post hay không, để lần sau đi tiếp.
   - Trả `checked`, `found`, `remaining` (còn bao nhiêu ứng viên), `failures`.

### 10.2 Tab Posts

- Bảng có: ô tìm kiếm, account, trạng thái, nguồn, khoảng thời gian, sắp xếp; mỗi dòng có nút copy post ID và link mở trên Facebook; chọn nhiều dòng → "Launch ads" hoặc "Copy post IDs"; nút "Refresh post IDs" (hiện số ad còn thiếu).
- Hộp thoại chi tiết creative liệt kê các post của creative đó, có nút copy.
- Gộp theo `post_id`; số liệu cộng bằng chuỗi tiền (BigInt micro), không cộng float. ROAS = revenue / spend (null nếu không có spend), CPA = spend / purchases (null nếu không có purchase).

### 10.3 Launch một post cũ

- Ad mang `postId` → Meta creative chỉ gồm `{ name, object_story_id, url_tags }`: không upload, không copy, không link. Ad hiện đúng bài cũ với like, comment, share, chữ, media, link và nút của bài.
- Cùng một post ở nhiều ad set (hoặc lặp trong một ad set) dùng chung một Meta creative.
- Trong pool, post có id `post:<postId>`. Sơ đồ, hộp thoại sửa ad set và trang review hiện post với nhãn "Post". Copy sửa tay không áp dụng cho post.
- Post phải thuộc page mà token có quyền quảng cáo; post của page khác sẽ bị Meta từ chối ở bước tạo creative (lỗi trả về theo từng ad).

## 11. Phân quyền

Nguyên tắc: **chỉ admin toàn quyền và thấy tất cả. Mọi người khác chỉ thấy dữ liệu của mình.** Mọi giới hạn phải kiểm tra ở server; lọc ở client chỉ để giao diện gọn.

### 11.1 Quyền

| Quyền | Dùng cho |
| --- | --- |
| `ads_launcher.use` | Mở launcher, preset, tab Posts, gọi `/launch`, `/posts`, `/posts/refresh` |
| `ads_manager.view_all_users` | Quyền admin: thấy và ghi vào mọi ad account, page, pixel của workspace |
| `creatives.view` | Xem thư viện creative (trong phạm vi) |
| `creatives.view_all` | Xem mọi creative (Adlux: admin, leader, creative leader) |
| `creatives.manage` | Upload, sửa, archive creative của mình |
| `ads.edit` | Bulk edit tên và copy trong Ads Manager |

### 11.2 Phạm vi dữ liệu

| Dữ liệu | Admin | Người khác |
| --- | --- | --- |
| Ad account | Tất cả | Chỉ account có dòng `ad_account_access` của chính họ |
| Facebook page, pixel | Tất cả | Chỉ page / pixel mà login Meta của chính họ với tới (`facebook_page_accesses`, `pixel_accesses`) |
| Store và landing page | Mọi store đang chạy | Store họ tạo + store được chia sẻ (`store_collaborators`); không có store thì danh sách trống |
| Creative | Tất cả | Sản phẩm được giao ∪ sản phẩm trong task của họ ∪ sản phẩm bán trên store của họ (clone tính về sản phẩm gốc) |
| Post | Mọi account | Chỉ account của họ |
| Preset | Của riêng mình | Của riêng mình |
| Launch | Ghi vào mọi account | Chỉ account có access; creative ngoài phạm vi coi như không tồn tại (404), không tạo gì |

Ngoài launcher, phạm vi creative áp dụng cho: danh sách thư viện, "Select all", ô chọn sản phẩm, bộ lọc người tạo, chi tiết creative (404 khi ngoài phạm vi), upload (403 khi ngoài phạm vi), analytics.

## 12. Frontend

### 12.1 Cấu trúc thư mục (mỗi feature)

```
api/        gọi HTTP mỏng, có kiểu (không React)
hooks/      TanStack Query + object khoá query theo cấp: all → lists() → list(params) → detail(id)
lib/        hàm thuần: planner, landing, nhãn, bộ nhớ setup (có unit test)
components/ chỉ hiển thị: props vào, sự kiện ra
pages/      ghép hook và component
```

### 12.2 Thành phần chính

- `lib/structure.ts`: `resolveStructure`, `fillTo`, `planStructure` (tên, audience, sửa tay, đếm, issues), `configIssues`, `setupIssues`, `targetIssues`, `buildStructureRequests` (một `LaunchRequest` mỗi campaign, mỗi ad set mang `ads` riêng, `ads` chung để trống).
- `lib/landing.ts`: `landingGroups(stores, productId)` (nhóm theo domain, id item `<storeId>|<optionId>`), `landingItemLabel` ("Product page · /path"), `findLanding(groups, url, storeId)`.
- `lib/setup-memory.ts`: lưu và đọc bộ nhớ setup theo user id; đọc/ghi localStorage luôn bọc try/catch.
- `hooks/use-run-launch.ts`: vòng lặp launch (dưới đây).
- Component: `WizardStepper`, `StepSetup`, `StepCreatives` (`CreativePoolPicker`, `PostPoolPicker`), `StepStructure` (`PresetPicker`, `PresetForm`, `StructureFields`, `StructureDiagram`, `AdsetEditDialog`), `StepReview` (`FacebookAdPreview` + ô sửa copy), `QuickLaunchDialog`, `PostLibrary`.
- State của wizard: một reducer; một kế hoạch duy nhất tính từ `planStructure`; sơ đồ, review và request đều đọc từ kế hoạch đó nên luôn khớp nhau.

### 12.3 Vòng lặp launch

```ts
const launchId = crypto.randomUUID();
for (const base of requests) {               // một request mỗi campaign, tuần tự
  const request = { ...base, requestId: crypto.randomUUID(), launchId };
  try { results.push({ request, result: await launchAds(request), error: null }); }
  catch (err) { results.push({ request, result: null, error: err.message }); }   // ghi lại rồi đi tiếp
}
// tổng: ok = Σ adsCreated; failed = Σ adsFailed + số request lỗi hẳn
```

Sau khi xong: invalidate query của creatives, options của launcher và Ads Manager. Toast "N ads launched" hoặc "N launched, M failed".

Giới hạn ở client lặp lại giới hạn của server (50 campaign, 50 ad set, 50 ad mỗi ad set, 200 ad mỗi campaign, tuổi 13 đến 65, id dạng số) để API không bao giờ phải từ chối một kế hoạch đã cho bấm Launch.

## 13. Bảng giới hạn

| Giới hạn | Giá trị |
| --- | --- |
| Campaign mỗi lần launch | 50 |
| Ad set mỗi campaign (mỗi request) | 50 |
| Ad mỗi ad set | 50 (giới hạn của Meta) |
| Ad mỗi campaign (mỗi request) | 200 |
| Audience mỗi preset | 1 đến 10 |
| Quốc gia mỗi audience | 1 đến 50 |
| Tuổi | 13 đến 65 |
| Thao tác mỗi batch Meta | 50 |
| Ad mỗi lần Refresh post IDs | 1000 |
| Hỏi lại post ID của một ad | sau 6 giờ |
| Post ID mỗi lần tra `postIds` | 100 |
| Lưu kết quả idempotency và cache tài sản | 24 giờ |
| URL parameters | 1024 ký tự |
| Tên node | 255 ký tự |
| Copy | headline 255, primary text 5000, description 255 |

## 14. Lỗi và trường hợp biên

- Bấm Launch hai lần, mạng chập chờn, back trình duyệt: `requestId` chặn tạo trùng (replay hoặc 409).
- Campaign tạo lỗi: không tạo gì thêm, mọi thứ bên dưới `skipped`.
- Một ad set lỗi: các ad set khác vẫn chạy.
- Một creative upload lỗi: chỉ các ad dùng creative đó lỗi.
- Meta đã tạo nhưng DB lỗi: `ok` + `warning`, không tạo lại.
- Creative bị archive giữa chừng: 404 kèm hướng dẫn khôi phục.
- Video không có URL công khai, hoặc Meta xử lý video lỗi: lỗi rõ ràng cho các ad của video đó.
- Token hết hạn hoặc app bị chặn: breaker mở, trả 502 "thử lại sau vài phút", không gọi thêm vào Meta.
- Không ai có token với tới account: 403 "Connect Facebook first".
- Campaign có sẵn bid kiểu khác preset: chặn ở web với câu giải thích; server kiểm tra lại.
- ABO mà ad set không có budget, hoặc tối ưu theo pixel mà không có pixel: ad set đó `failed` kèm lý do, các ad set khác vẫn chạy (web đã chặn trước nên hiếm gặp).
- Pool chỉ có post cũ: không cần landing page.
- Cấu trúc cố định nhỏ hơn pool: chặn, nhắc dùng `n` hoặc bớt creative.
- Redis không chạy: launch vẫn được (mất replay và cache).
- Preset cũ chưa có `repeatToFill` / `bidStrategy`: hiểu là repeat bật và Highest volume.

## 15. Kiểm thử

### 15.1 Unit test (bắt buộc cho mỗi hàm thuần)

- Planner: mọi mẫu `C:S:A`, repeat bật/tắt, `leftOut`, sửa tay, đặt tên, đánh số trùng, issues.
- Schema: request (ad mỗi ad set, tổng 200, post không có copy, destination tuỳ chọn, bid), preset (bid cần số tiền, ROAS cần VALUE).
- Trường Meta: campaign, ad set (CBO/ABO, bid, promoted_object, targeting), creative (ảnh, video, post), `majorToMinor`, `roasToFloor`.
- Writer: chia batch 50, lỗi từng phần tử, phần tử null, batch hỏng cả request.
- Use case với writer giả: dùng chung creative, cache trúng thì bỏ qua upload, batch lỗi chỉ hỏng một ad, mirror lỗi thành warning, phạm vi sản phẩm, đánh số tên lặp, đọc lại post ID.
- Refresh: đóng dấu mọi ad đã hỏi, bỏ qua ad hỏi trong 6 giờ, failures theo account, remaining.
- Route: idempotency (claimed / replay / running / Redis lỗi / nhả key khi lỗi), 403/404.

### 15.2 Test trên trình duyệt (tài khoản demo, writer giả)

1. Wizard `1:n:1` và `3:1:n`: số trên sơ đồ khớp số trong DB.
2. `1:1:3` với một creative và Cost cap 25: 3 ad `#1..#3` dùng chung một Meta creative, campaign `COST_CAP`, ad set `bid_amount = 2500`.
3. ROAS goal 1.8: ad set `optimization_goal = VALUE`, `roas_average_floor = 18000`.
4. Campaign có sẵn đang Cost cap + preset Highest volume: bị chặn với thông báo; đổi preset cho khớp thì qua.
5. Refresh post IDs; tab Posts lọc, copy, mở Facebook; quick launch một post → ad mới có cùng `post_id`, liên kết đúng creative.
6. Deep link `?creatives=` / `?posts=`; quick launch từ thư viện và trang sản phẩm.
7. Landing page nhóm theo domain; chọn trang ở domain thứ ba thì URL và display link đổi theo.
8. Phân quyền với một seller tạm: chỉ thấy store, page, pixel, creative của mình; mở creative ngoài phạm vi ra 404; launch creative ngoài phạm vi bị từ chối và không tạo gì. Xoá seller tạm sau khi test.
9. Màn hình 1366×768, 1440×900 và điện thoại 390×844: không cuộn ngang, nút không che field.

## 16. Thứ tự triển khai đề xuất cho dự án mới

1. **Dữ liệu**: bảng `creatives`, cột `ads.creative_id`, `ads.post_id`, `ads.post_checked_at`, bảng `launch_presets` (migration chỉ thêm).
2. **Schema dùng chung** (zod hoặc tương đương): request launch, kết quả, preset, post.
3. **Port `MetaAdsWriter`** + writer thật + writer giả + account demo. Làm writer giả trước để test toàn luồng không cần token.
4. **Use case launch** + route (quyền, idempotency, chọn writer, breaker) + mirror.
5. **Planner** ở frontend + unit test đầy đủ.
6. **Wizard** 4 bước + sơ đồ + preview + vòng lặp launch.
7. **Preset**: API + preset mẫu + form.
8. **Quick launch** từ thư viện và trang sản phẩm.
9. **Post cũ**: sync `effective_object_story_id`, đọc lại khi launch, refresh, tab Posts, launch post.
10. **Bid strategy** trong preset, request và trường Meta.
11. **Phân quyền** theo mục 11, test bằng một user không phải admin.
12. **Chạy thật**: một account thật, trạng thái PAUSED, kiểm tra trên Ads Manager của Meta rồi mới bật ACTIVE.

## 17. Lưu ý khi chạy thật

- Token Facebook cần quyền `ads_management` (Adlux xin thêm `ads_read`, `business_management`), và tài khoản phải có quyền quảng cáo trên page dùng để chạy.
- Video: file phải tải được qua HTTPS công khai (biến `PUBLIC_ASSET_BASE_URL`, hoặc mặc định là URL công khai của API). Máy local cần tunnel (ví dụ ngrok).
- Reverse proxy cho upload creative: cho phép body lớn (Adlux: 500 MB) và timeout đọc dài (`client_max_body_size 500m; proxy_read_timeout 1800s;` với nginx).
- Luôn launch PAUSED lần đầu, xem lại trên Ads Manager của Meta, rồi mới bật.
- Ghi lại header usage của Meta (`x-app-usage`, `x-business-use-case-usage`, `x-ad-account-usage`) và mở circuit breaker khi token/app lỗi, để không bị Meta khoá lâu hơn.

## 18. Tham chiếu Adlux (code mẫu)

| Phần | File |
| --- | --- |
| Hợp đồng request/kết quả, bid, post ID | `packages/shared-types/src/domain/ads-launcher.ts` |
| Preset, structure, preset mẫu | `packages/shared-types/src/domain/launch-preset.ts` |
| Tab Posts (query, DTO, refresh) | `packages/shared-types/src/domain/ad-post.ts` |
| Route, quyền, idempotency, chọn writer | `apps/api/src/features/ads-launcher/ads-launcher.routes.ts` |
| Use case launch | `apps/api/src/features/ads-launcher/application/use-cases/launch-ads.use-case.ts` |
| Port writer | `apps/api/src/features/ads-launcher/application/ports/meta-ads-writer.ts` |
| Writer Meta thật / giả | `apps/api/src/features/ads-launcher/infrastructure/fb-meta-ads-writer.ts`, `fake-meta-ads-writer.ts` |
| Trường Meta (hàm thuần) | `apps/api/src/features/ads-launcher/domain/meta-params.ts` |
| Khoá dùng chung creative, đánh số tên | `apps/api/src/features/ads-launcher/domain/creative-key.ts`, `ad-names.ts` |
| Cache tài sản, tìm token | `apps/api/src/features/ads-launcher/infrastructure/launch-asset-cache.ts`, `token-owner.ts` |
| Refresh post ID | `apps/api/src/features/ads-launcher/application/use-cases/refresh-ad-posts.use-case.ts` |
| Planner | `apps/web/src/features/ads-launcher/lib/structure.ts` |
| Landing page theo domain | `apps/web/src/features/ads-launcher/lib/landing.ts` |
| Vòng lặp launch | `apps/web/src/features/ads-launcher/hooks/use-run-launch.ts` |
| Wizard | `apps/web/src/features/ads-launcher/pages/ads-launcher.page.tsx` |
