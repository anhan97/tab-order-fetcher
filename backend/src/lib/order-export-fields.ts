/**
 * Single source of truth for the fulfillment export.
 *
 * Every column a user can put in an exported CSV/text file is declared once
 * here (key + Vietnamese UI label + English file header + how to pull the
 * value off an order row). The frontend fetches this list to render the
 * column picker, and the export endpoint uses the same list to build the file
 * — so adding a new exportable column is a one-line change here and never
 * needs a DB migration (presets store column *keys*, not labels).
 *
 * A "row" is one order line item (an order with N line items => N rows; a
 * single line item with quantity 2 stays one row with Quantity = 2), matching
 * how suppliers pick/pack.
 */

export interface ExportRowCtx {
  /** Prisma Order row (with shippingAddress Json, totals, tracking, …). */
  order: any;
  /** The current line item, or null for an order that has none. */
  lineItem: any | null;
  /** order.shippingAddress || {} — hoisted so field getters stay terse. */
  address: any;
}

export interface ExportFieldDef {
  key: string;
  /** Vietnamese label shown in the column-picker UI. */
  label: string;
  /** English column header written into the exported file. */
  header: string;
  get: (ctx: ExportRowCtx) => string | number;
}

const num = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

export const EXPORT_FIELDS: ExportFieldDef[] = [
  { key: 'orderNumber',    label: 'Mã đơn',           header: 'Order Number',    get: ({ order }) => order.orderNumber ?? '' },
  { key: 'processedAt',    label: 'Ngày đặt',         header: 'Order Date',      get: ({ order }) => (order.processedAt ? new Date(order.processedAt).toISOString().slice(0, 10) : '') },
  { key: 'fulfillStatus',  label: 'Trạng thái xử lý', header: 'Fulfill Status',  get: ({ order }) => order.fulfillStatus ?? '' },
  { key: 'paymentStatus',  label: 'Thanh toán',       header: 'Payment Status',  get: ({ order }) => order.status ?? '' },
  { key: 'deliveryStatus', label: 'Trạng thái giao',  header: 'Delivery Status', get: ({ order }) => order.deliveryStatus ?? '' },

  { key: 'customerName',   label: 'Tên khách',        header: 'NAME',            get: ({ order, address }) => order.customerName ?? address.name ?? '' },
  { key: 'customerEmail',  label: 'Email',            header: 'EMAIL',           get: ({ order }) => order.customerEmail ?? '' },
  { key: 'customerPhone',  label: 'SĐT',              header: 'Phone Number',    get: ({ order, address }) => order.customerPhone ?? address.phone ?? '' },

  { key: 'address1',       label: 'Địa chỉ 1',        header: 'Address',         get: ({ address }) => address.address1 ?? '' },
  { key: 'address2',       label: 'Địa chỉ 2',        header: 'Address 2',       get: ({ address }) => address.address2 ?? '' },
  { key: 'city',           label: 'Thành phố',        header: 'City',            get: ({ address }) => address.city ?? '' },
  { key: 'province',       label: 'Tỉnh/Bang',        header: 'State/Province',  get: ({ address }) => address.province ?? '' },
  { key: 'provinceCode',   label: 'Mã Tỉnh/Bang',     header: 'State Code',      get: ({ address }) => address.province_code ?? address.provinceCode ?? '' },
  { key: 'zip',            label: 'Mã bưu chính',     header: 'Postal Code',     get: ({ address }) => address.zip ?? '' },
  { key: 'country',        label: 'Quốc gia',         header: 'Country',         get: ({ address }) => address.country ?? '' },
  { key: 'countryCode',    label: 'Mã QG',            header: 'Country Code',    get: ({ order, address }) => address.country_code ?? address.countryCode ?? order.shippingCountryCode ?? '' },
  {
    key: 'fullAddress',
    label: 'Địa chỉ đầy đủ',
    header: 'Full Address',
    get: ({ address }) => [address.address1, address.address2, address.city, address.province, address.zip, address.country].filter(Boolean).join(', ')
  },

  { key: 'productTitle', label: 'Sản phẩm',    header: 'Product Name', get: ({ lineItem }) => lineItem?.title ?? '' },
  { key: 'sku',          label: 'SKU',         header: 'Product SKU',  get: ({ lineItem }) => lineItem?.sku ?? '' },
  { key: 'style',        label: 'Style (màu)', header: 'STYLE(COLOR)', get: ({ lineItem }) => lineItem?.variantTitle ?? '' },
  { key: 'quantity',     label: 'Số lượng',    header: 'Quantity',     get: ({ lineItem }) => (lineItem ? lineItem.quantity : '') },
  { key: 'itemPrice',    label: 'Đơn giá',     header: 'Item Price',   get: ({ lineItem }) => num(lineItem?.price) },
  {
    key: 'itemTotal',
    label: 'Thành tiền',
    header: 'Item Total',
    get: ({ lineItem }) => (lineItem?.price != null ? (Number(lineItem.price) * (lineItem.quantity || 0)).toFixed(2) : '')
  },

  { key: 'orderTotal',     label: 'Tổng đơn',     header: 'Order Total',     get: ({ order }) => num(order.totalAmount) },
  { key: 'currency',       label: 'Tiền tệ',      header: 'Currency',        get: ({ order }) => order.currency ?? '' },
  { key: 'trackingNumber', label: 'Mã vận đơn',   header: 'Tracking Number', get: ({ order }) => order.trackingNumber ?? '' },
  { key: 'carrier',        label: 'Đơn vị VC',    header: 'Carrier',         get: ({ order }) => order.shippingCompany ?? '' },
  { key: 'supplier',       label: 'Nhà cung cấp', header: 'Supplier',        get: ({ order }) => order.supplier ?? '' }
];

export const EXPORT_FIELD_MAP: Map<string, ExportFieldDef> = new Map(EXPORT_FIELDS.map(f => [f.key, f]));

/**
 * Default layout for a fresh export (no preset chosen):
 *   Order Number, Order Date, Product SKU, Product Name, STYLE(COLOR),
 *   Quantity, EMAIL, NAME, Address, City, State/Province, Postal Code,
 *   Country Code, Phone Number
 */
export const DEFAULT_EXPORT_COLUMNS: string[] = [
  'orderNumber', 'processedAt', 'sku', 'productTitle', 'style', 'quantity',
  'customerEmail', 'customerName', 'address1', 'city', 'province', 'zip',
  'countryCode', 'customerPhone'
];

/** Keep only known column keys, preserving the caller's order. */
export function sanitizeColumns(cols: unknown): string[] {
  if (!Array.isArray(cols)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of cols) {
    const key = String(c);
    if (EXPORT_FIELD_MAP.has(key) && !seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

export type ExportDelimiter = 'comma' | 'tab';

/**
 * Turn rows into a CSV (comma, RFC-4180 quoting) or TSV (tab, paste-into-sheet
 * friendly — tabs/newlines inside a value collapse to spaces so columns don't
 * shift). Returned WITHOUT the UTF-8 BOM; the caller adds it for downloads.
 */
export function serializeRows(rows: string[][], delimiter: ExportDelimiter): string {
  if (delimiter === 'tab') {
    return rows
      .map(r => r.map(c => c.replace(/[\t\r\n]+/g, ' ')).join('\t'))
      .join('\r\n');
  }
  const esc = (s: string): string => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return rows.map(r => r.map(esc).join(',')).join('\r\n');
}
