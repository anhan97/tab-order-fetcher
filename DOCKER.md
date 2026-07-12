# Chạy bằng Docker

Full stack trong 3 container: **db** (Postgres 16) · **backend** (Express + Prisma) ·
**frontend** (nginx phục vụ bản build Vite + proxy `/api` sang backend).
Trình duyệt chỉ nói chuyện với 1 origin — nginx đẩy `/api` vào backend.

## Chạy local

```bash
cp .env.docker.example .env.docker      # rồi điền JWT_SECRET, ADMIN_EMAIL, FRONTEND_URL
docker compose up -d --build
```

Mở **http://localhost:8080** (đổi bằng `FRONTEND_PORT`). Backend tự chạy
`prisma migrate deploy` lúc khởi động nên DB được tạo bảng sẵn.

Tài khoản admin: đăng ký bằng đúng email trong `ADMIN_EMAIL` → tự lên admin +
ACTIVE (bỏ qua hàng chờ duyệt). Mọi user khác vào trạng thái PENDING chờ admin duyệt.

Lệnh hay dùng:
```bash
docker compose ps                 # trạng thái container
docker compose logs -f backend    # log backend (migration, scheduler, webhook…)
docker compose down               # dừng (giữ dữ liệu)
docker compose down -v            # dừng + XOÁ dữ liệu (volume pgdata)
```

## Cấu hình (.env.docker)

| Biến | Bắt buộc | Ghi chú |
|---|---|---|
| `JWT_SECRET` | ✅ | Khoá ký JWT + dẫn xuất khoá mã hoá token store. Đổi = mọi phiên & token store cũ hỏng. |
| `ADMIN_EMAIL` | ✅ | Email này đăng nhập tự thành admin + ACTIVE. |
| `FRONTEND_URL` | ✅ | URL người dùng mở app (redirect sau OAuth + CORS). |
| `SHOPIFY_CLIENT_ID/SECRET` | — | App Shopify hệ thống (fallback). Mỗi user vẫn tự thêm app riêng trong UI. |
| `SHOPIFY_APP_URL` | — | URL public của **backend** cho callback OAuth + webhook. Đi qua nginx thì = `FRONTEND_URL`. |
| `TRACK17_API_KEY` | — | Bật tự cập nhật DELIVERED theo hãng vận chuyển. |
| `FRONTEND_PORT` / `BACKEND_PORT` / `DB_PORT` | — | Cổng publish ra host (mặc định 8080 / 3001 / 55432). |
| `VITE_FACEBOOK_APP_ID` | — | Bake vào frontend lúc build; đổi phải `--build-arg` + build lại image frontend. |

`DATABASE_URL` **không cần đặt** — compose tự nối backend tới container `db`.

## Deploy lên server

1. Cài Docker + Docker Compose trên server, copy repo lên (hoặc `git clone`).
2. Tạo `.env.docker`:
   - `JWT_SECRET` = chuỗi ngẫu nhiên dài (vd `openssl rand -hex 32`).
   - `FRONTEND_URL` và `SHOPIFY_APP_URL` = domain thật, vd `https://app.tencuaban.com`.
   - `ADMIN_EMAIL` = email của bạn.
3. `docker compose up -d --build`.
4. Đặt reverse proxy có TLS (Caddy/nginx/Traefik) trước cổng frontend để có HTTPS.
   Ví dụ Caddy:
   ```
   app.tencuaban.com {
       reverse_proxy localhost:8080
   }
   ```
   (Shopify OAuth + webhook bắt buộc HTTPS ở production.)
5. Trong Shopify Partner app, khai **Allowed redirection URL**:
   `https://app.tencuaban.com/api/shopify/oauth/callback`.

### Cập nhật phiên bản mới
```bash
git pull
docker compose up -d --build      # migration mới tự apply lúc backend khởi động
```

### Sao lưu / phục hồi dữ liệu
Dữ liệu nằm trong volume `pgdata`:
```bash
# backup
docker compose exec -T db pg_dump -U postgres tab_order_fetcher > backup.sql
# restore
cat backup.sql | docker compose exec -T db psql -U postgres tab_order_fetcher
```

## Lưu ý build

- Backend build tách `src/server.ts` (stub 3-route cũ) và `src/routes/cogs.ts`
  (kéo dep `zod` không khai báo) — entrypoint thật là `backend/server.ts`.
- Frontend `VITE_*` là biến build-time: đổi phải build lại image frontend.
- Lần build đầu chậm (npm ci + tsc + vite cho 2 image, ~vài phút); các lần sau
  Docker cache lại nên nhanh hơn nhiều nếu chưa đổi dependencies.
