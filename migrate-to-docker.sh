#!/usr/bin/env bash
#
# migrate-to-docker.sh — Chuyển deploy "kiểu cũ" (PM2 + nginx host + Postgres native)
# sang Docker Compose (db + backend + frontend), GIỮ NGUYÊN dữ liệu cũ.
#
# Cách dùng trên server:
#   1. Sửa 3 biến trong khối CONFIG bên dưới cho khớp server của bạn.
#   2. Đảm bảo repo trên server đã có code mới (Dockerfile/docker-compose.yml) — script sẽ git pull.
#   3. Chạy:  sudo bash migrate-to-docker.sh
#
# Script an toàn để chạy lại nhiều lần (idempotent): đã có data thì không nạp đè,
# Postgres native KHÔNG bị xoá — chỉ in hướng dẫn tắt sau khi bạn xác nhận OK.
#
set -euo pipefail

# ─────────────────────────── CONFIG — SỬA 3 DÒNG NÀY ───────────────────────────
REPO_DIR="/var/www/tab-order-fetcher"   # thư mục repo trên server
DOMAIN="app.tencuaban.com"              # domain thật, đã trỏ DNS về VPS này
OLD_DB="tab_order_fetcher"              # tên database Postgres native cũ
# ───────────────────────────────────────────────────────────────────────────────

# Mặc định của docker-compose.yml (đổi nếu bạn set khác trong .env.docker)
DOCKER_USER="postgres"
DOCKER_DB="tab_order_fetcher"
FRONTEND_PORT="8080"
BACKUP_FILE="${HOME}/backup_old_$(date +%F_%H%M%S).sql"

# ── tiện ích log ──
c_green="\033[0;32m"; c_yellow="\033[1;33m"; c_red="\033[0;31m"; c_reset="\033[0m"
step() { echo -e "\n${c_green}==> $*${c_reset}"; }
warn() { echo -e "${c_yellow}!  $*${c_reset}"; }
die()  { echo -e "${c_red}✗  $*${c_reset}" >&2; exit 1; }

dc() { docker compose "$@"; }   # docker compose wrapper

# ─────────────────────────── 0. PREFLIGHT ───────────────────────────
step "Kiểm tra môi trường"
[ "$(id -u)" -eq 0 ] || die "Hãy chạy bằng sudo:  sudo bash migrate-to-docker.sh"
command -v docker >/dev/null      || die "Chưa cài docker."
docker compose version >/dev/null || die "Chưa có 'docker compose' (plugin v2)."
[ -d "$REPO_DIR" ]                || die "Không thấy thư mục repo: $REPO_DIR"
cd "$REPO_DIR"
[ -f docker-compose.yml ]         || die "Không thấy docker-compose.yml trong $REPO_DIR (git pull đủ code mới chưa?)"

echo "Repo:   $REPO_DIR"
echo "Domain: $DOMAIN"
echo "DB cũ:  $OLD_DB  →  container db ($DOCKER_DB)"
echo "Backup: $BACKUP_FILE"

# ─────────────────────────── 1. BACKUP POSTGRES NATIVE ───────────────────────────
step "Sao lưu database cũ (không bỏ qua)"
if sudo -u postgres psql -lqt 2>/dev/null | cut -d '|' -f1 | grep -qw "$OLD_DB"; then
  sudo -u postgres pg_dump --no-owner --no-privileges "$OLD_DB" > "$BACKUP_FILE"
  [ -s "$BACKUP_FILE" ] || die "File backup rỗng — dừng lại để tránh mất data."
  echo "Đã dump: $(du -h "$BACKUP_FILE" | cut -f1)  → $BACKUP_FILE"
else
  warn "Không tìm thấy DB native '$OLD_DB' (có thể đã migrate trước đó). Bỏ qua backup + nạp data."
  BACKUP_FILE=""
fi

# ─────────────────────────── 2. .env.docker ───────────────────────────
step "Kiểm tra .env.docker"
if [ ! -f .env.docker ]; then
  [ -f backend/.env ] || die ".env.docker chưa có và không thấy backend/.env để copy. Tạo .env.docker thủ công (xem .env.docker.example) rồi chạy lại."
  warn ".env.docker chưa có — copy TOÀN BỘ backend/.env cũ rồi ghi đè các biến riêng cho Docker."
  # Copy nguyên file cũ (giữ đủ JWT_SECRET, SMTP, FACEBOOK_*, CORS_ORIGINS, SHOPIFY_*...),
  # sau đó append overrides — env_file của docker lấy giá trị xuất hiện SAU CÙNG nên ghi đè được.
  # DATABASE_URL cũ (localhost) vô hại: docker-compose.yml đã đè bằng db:5432.
  cp backend/.env .env.docker
  cat >> .env.docker <<EOF

# ── Docker overrides (thêm tự động bởi migrate-to-docker.sh) ──
FRONTEND_URL=https://${DOMAIN}
SHOPIFY_APP_URL=https://${DOMAIN}
POSTGRES_USER=${DOCKER_USER}
POSTGRES_PASSWORD=postgres
POSTGRES_DB=${DOCKER_DB}
EOF
  warn "Đã tạo .env.docker từ file cũ — MỞ RA KIỂM TRA (nhất là FRONTEND_URL/SHOPIFY_APP_URL) trước khi tin tưởng."
fi
grep -qE '^JWT_SECRET=.+' .env.docker || die "JWT_SECRET trống trong .env.docker — điền đúng giá trị cũ rồi chạy lại."

# ─────────────────────────── 3. LẤY CODE MỚI ───────────────────────────
step "git pull (lấy Dockerfile/compose mới nhất)"
git pull --ff-only || warn "git pull bỏ qua (có thay đổi local hoặc không phải git). Đảm bảo code Docker đã có sẵn."

# ─────────────────────────── 4. TẮT PM2 (giải phóng cổng 3001) ───────────────────────────
step "Dừng tiến trình PM2 cũ"
if command -v pm2 >/dev/null; then
  pm2 stop all || true
  pm2 delete all || true
  pm2 save --force || true
  pm2 unstartup systemd || true
  echo "Đã dừng & gỡ PM2. (Nếu PM2 chạy dưới user khác, kiểm tra lại thủ công.)"
else
  warn "Không thấy lệnh pm2 — bỏ qua. Kiểm tra không còn tiến trình nào giữ cổng 3001."
fi

# ─────────────────────────── 5. BẬT DB + NẠP DATA + BẬT FULL STACK ───────────────────────────
step "Khởi động container db"
dc up -d db
echo -n "Chờ Postgres sẵn sàng"
for i in $(seq 1 30); do
  if dc exec -T db pg_isready -U "$DOCKER_USER" -d "$DOCKER_DB" >/dev/null 2>&1; then echo " ✓"; break; fi
  echo -n "."; sleep 2
  [ "$i" -eq 30 ] && die "DB không lên sau 60s."
done

step "Nạp dữ liệu cũ vào container db (chỉ khi DB còn rỗng)"
TABLE_COUNT=$(dc exec -T db psql -U "$DOCKER_USER" -d "$DOCKER_DB" -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" | tr -d '[:space:]')
if [ -n "$BACKUP_FILE" ] && [ "$TABLE_COUNT" = "0" ]; then
  cat "$BACKUP_FILE" | dc exec -T db psql -v ON_ERROR_STOP=0 -U "$DOCKER_USER" -d "$DOCKER_DB"
  echo "Đã nạp data. Backend sẽ tự 'prisma migrate deploy' để nâng schema lên bản mới."
elif [ "$TABLE_COUNT" != "0" ]; then
  warn "DB container đã có $TABLE_COUNT bảng — bỏ qua nạp data (tránh đè). Migration mới vẫn tự apply."
else
  warn "Không có file backup để nạp — DB bắt đầu rỗng."
fi

step "Build + bật backend & frontend"
dc up -d --build

echo -n "Chờ backend healthy"
for i in $(seq 1 45); do
  if dc exec -T backend curl -fsS http://localhost:3001/api/test >/dev/null 2>&1; then echo " ✓"; break; fi
  echo -n "."; sleep 3
  [ "$i" -eq 45 ] && { warn "Backend chưa healthy sau ~135s — xem: docker compose logs backend"; }
done

# ─────────────────────────── 6. NGINX HOST → REVERSE PROXY :8080 ───────────────────────────
step "Cấu hình nginx host thành reverse proxy sang :$FRONTEND_PORT (giữ cert Certbot)"
NGINX_AVAIL="/etc/nginx/sites-available/tab-order-fetcher"
CERT_DIR="/etc/letsencrypt/live/${DOMAIN}"

[ -f "$NGINX_AVAIL" ] && cp "$NGINX_AVAIL" "${NGINX_AVAIL}.bak_$(date +%F_%H%M%S)" && echo "Đã backup nginx config cũ."

PROXY_BLOCK='    location / {
        proxy_pass http://localhost:'"$FRONTEND_PORT"';
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_cache_bypass $http_upgrade;
    }'

if [ -f "${CERT_DIR}/fullchain.pem" ]; then
  cat > "$NGINX_AVAIL" <<EOF
server {
    listen 80;
    server_name ${DOMAIN};
    return 301 https://\$host\$request_uri;
}
server {
    listen 443 ssl;
    server_name ${DOMAIN};

    ssl_certificate     ${CERT_DIR}/fullchain.pem;
    ssl_certificate_key ${CERT_DIR}/privkey.pem;
    client_max_body_size 25m;

${PROXY_BLOCK}
}
EOF
  echo "Dùng cert Certbot có sẵn tại ${CERT_DIR}."
else
  cat > "$NGINX_AVAIL" <<EOF
server {
    listen 80;
    server_name ${DOMAIN};
    client_max_body_size 25m;

${PROXY_BLOCK}
}
EOF
  warn "Chưa thấy cert cho ${DOMAIN}. Sau khi script xong, chạy:  sudo certbot --nginx -d ${DOMAIN}"
fi

ln -sf "$NGINX_AVAIL" /etc/nginx/sites-enabled/tab-order-fetcher
[ -f /etc/nginx/sites-enabled/default ] && rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx && echo "nginx reload ✓"

# ─────────────────────────── 7. XONG ───────────────────────────
step "HOÀN TẤT"
dc ps
cat <<EOF

${c_green}Kiểm tra ngay:${c_reset}
  • Mở  https://${DOMAIN}  → đăng nhập, xem order/store đã đủ (data đã migrate).
  • Thử OAuth Shopify + webhook. Cập nhật Allowed redirection URL trong Shopify Partner nếu cần:
      https://${DOMAIN}/api/shopify/oauth/callback
  • Log:  cd ${REPO_DIR} && docker compose logs -f backend

${c_yellow}CHỈ KHI đã xác nhận mọi thứ chạy đúng${c_reset} (nên chờ 1-2 ngày), mới tắt Postgres native
để tránh chạy song song 2 DB. File backup đang ở: ${BACKUP_FILE:-<không tạo>}
      sudo systemctl stop postgresql
      sudo systemctl disable postgresql
EOF
