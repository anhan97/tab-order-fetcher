#!/usr/bin/env bash
#
# deploy_vps.sh — Deploy 1 phát Order Manager lên VPS Ubuntu SẠCH.
# Docker Compose (db + backend + frontend) + nginx reverse proxy + HTTPS Let's Encrypt.
#
# ── Cách dùng ────────────────────────────────────────────────────────────────
# Trên VPS, chạy đúng 2 lệnh (không cần điền gì — script tự sinh key/mật khẩu):
#
#   curl -fsSL https://raw.githubusercontent.com/anhan97/tab-order-fetcher/feat/fulfillment-suite/deploy_vps.sh -o deploy_vps.sh
#   sudo DOMAIN=app.tencuaban.com bash deploy_vps.sh
#
# Không truyền DOMAIN thì script hỏi (nếu chạy tương tác), hoặc tự dùng IP public
# và chạy HTTP — vẫn lên app, chỉ là Shopify OAuth cần HTTPS nên phải gắn domain sau.
#
# Script TỰ SINH: JWT_SECRET, mật khẩu Postgres, toàn bộ .env.docker, vhost nginx, cert TLS.
#
# CHẠY LẠI NHIỀU LẦN ĐƯỢC (idempotent):
#   • .env.docker đã có  → KHÔNG ghi đè (giữ JWT_SECRET; đổi là hỏng hết token store đã lưu)
#   • cert Certbot đã có → giữ nguyên, chỉ viết lại vhost cho đúng
#   • lần sau chạy = git pull + build lại + restart (migration tự apply lúc backend khởi động)
#
# ⚠ Script này dành cho VPS MỚI. VPS đang chạy bản cũ (PM2 + Postgres native) thì
#   dùng migrate-to-docker.sh để giữ dữ liệu cũ — ĐỪNG dùng file này.
#
set -euo pipefail

# ─────────── CONFIG — để trống cũng chạy được, hoặc truyền qua biến môi trường ───────────
DOMAIN="${DOMAIN:-}"                    # domain đã trỏ A record về IP VPS này (để trống = hỏi, hoặc dùng IP)
ADMIN_EMAIL="${ADMIN_EMAIL:-anhan8910@gmail.com}"   # email này login là tự thành admin + dùng đăng ký Let's Encrypt
REPO_URL="${REPO_URL:-https://github.com/anhan97/tab-order-fetcher.git}"
BRANCH="${BRANCH:-feat/fulfillment-suite}"
REPO_DIR="${REPO_DIR:-/var/www/tab-order-fetcher}"
APP_PORT="${APP_PORT:-8080}"            # cổng nội bộ của frontend (chỉ bind 127.0.0.1)
SKIP_TLS="${SKIP_TLS:-0}"               # =1 khi DNS chưa trỏ xong → chạy HTTP trước, cấp cert sau
# ────────────────────────────────────────────────────────────────────────────────────────

c_green="\033[0;32m"; c_yellow="\033[1;33m"; c_red="\033[0;31m"; c_reset="\033[0m"
step() { echo -e "\n${c_green}==> $*${c_reset}"; }
warn() { echo -e "${c_yellow}!  $*${c_reset}"; }
die()  { echo -e "${c_red}x  $*${c_reset}" >&2; exit 1; }

# ─────────────────────────── 0. PREFLIGHT ───────────────────────────
step "Kiểm tra môi trường"
[ "$(id -u)" -eq 0 ] || die "Chạy bằng root:  sudo bash deploy_vps.sh"
command -v apt-get >/dev/null || die "Script này cho Ubuntu/Debian (không thấy apt-get)."
case "$ADMIN_EMAIL" in *@*.*) ;; *) die "ADMIN_EMAIL không hợp lệ: $ADMIN_EMAIL" ;; esac

# Script nằm sẵn trong repo (đã scp/clone thủ công) thì dùng luôn thư mục đó.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -f "$SCRIPT_DIR/docker-compose.yml" ] && REPO_DIR="$SCRIPT_DIR"

SERVER_IP="$(curl -fsS --max-time 10 https://api.ipify.org 2>/dev/null || true)"
[ -n "$SERVER_IP" ] || SERVER_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"

# Domain: ưu tiên biến truyền vào → hỏi (nếu tương tác) → fallback IP + HTTP.
if [ -z "$DOMAIN" ]; then
  if [ -t 0 ]; then
    echo
    read -r -p "Domain đã trỏ về VPS này (Enter để bỏ qua, dùng IP ${SERVER_IP} và chạy HTTP): " DOMAIN
  fi
  if [ -z "$DOMAIN" ]; then
    [ -n "$SERVER_IP" ] || die "Không xác định được IP public. Chạy lại với:  sudo DOMAIN=app.tencuaban.com bash deploy_vps.sh"
    DOMAIN="$SERVER_IP"
    SKIP_TLS=1
    warn "Không có domain → chạy HTTP trên http://${SERVER_IP}. Shopify OAuth/webhook BẮT BUỘC HTTPS,"
    warn "nên khi có domain hãy chạy lại:  sudo DOMAIN=app.tencuaban.com bash ${BASH_SOURCE[0]}"
  fi
fi

echo "Domain : $DOMAIN"
echo "Admin  : $ADMIN_EMAIL"
echo "Repo   : $REPO_DIR  (branch $BRANCH)"
echo "IP VPS : ${SERVER_IP:-?}"
echo "TLS    : $([ "$SKIP_TLS" = "1" ] && echo 'bỏ qua (HTTP)' || echo "Let's Encrypt")"

# ─────────────────────────── 1. GÓI HỆ THỐNG ───────────────────────────
step "Cài gói hệ thống (git, nginx, certbot, openssl…)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends \
  git nginx certbot python3-certbot-nginx curl ca-certificates ufw openssl

step "Cài Docker Engine + plugin compose"
if command -v docker >/dev/null && docker compose version >/dev/null 2>&1; then
  echo "Đã có: $(docker --version) / compose $(docker compose version --short)"
else
  curl -fsSL https://get.docker.com | sh
  docker compose version >/dev/null 2>&1 || die "Cài Docker xong nhưng không có plugin 'docker compose' v2."
fi
systemctl enable --now docker

# ─────────────────────────── 2. LẤY CODE ───────────────────────────
step "Lấy source code"
if [ -d "$REPO_DIR/.git" ]; then
  git -C "$REPO_DIR" fetch origin "$BRANCH"
  git -C "$REPO_DIR" checkout "$BRANCH"
  git -C "$REPO_DIR" pull --ff-only || warn "git pull bỏ qua (có thay đổi local). Dùng code đang có trên server."
else
  mkdir -p "$(dirname "$REPO_DIR")"
  git clone -b "$BRANCH" "$REPO_URL" "$REPO_DIR"
fi
cd "$REPO_DIR"
[ -f docker-compose.yml ] || die "Không thấy docker-compose.yml trong $REPO_DIR — sai branch?"

PROTO="http"; [ "$SKIP_TLS" = "1" ] || PROTO="https"
APP_URL="${PROTO}://${DOMAIN}"

# ─────────────────────────── 3. .env.docker — TỰ SINH TOÀN BỘ ───────────────────────────
step "Tạo .env.docker (tự sinh JWT_SECRET + mật khẩu Postgres)"
if [ -f .env.docker ]; then
  warn ".env.docker đã có — GIỮ NGUYÊN (không đụng JWT_SECRET để phiên đăng nhập & token store cũ không hỏng)."
  grep -qE '^JWT_SECRET=.+' .env.docker || die "JWT_SECRET trống trong .env.docker — điền rồi chạy lại."
else
  [ -f .env.docker.example ] || die "Không thấy .env.docker.example."
  cp .env.docker.example .env.docker
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 32)|"                 .env.docker
  sed -i "s|^ADMIN_EMAIL=.*|ADMIN_EMAIL=${ADMIN_EMAIL}|"                        .env.docker
  sed -i "s|^FRONTEND_URL=.*|FRONTEND_URL=${APP_URL}|"                          .env.docker
  # Postgres chỉ nghe trong mạng nội bộ docker, nhưng vẫn đặt mật khẩu ngẫu nhiên thay vì 'postgres'.
  sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 16)|"   .env.docker
  printf '\n# ── Thêm tự động bởi deploy_vps.sh ──\n# URL public của backend cho OAuth callback + webhook (qua nginx nên = FRONTEND_URL)\nSHOPIFY_APP_URL=%s\n' "$APP_URL" >> .env.docker
  chmod 600 .env.docker
  echo "Đã tạo .env.docker — key sinh ngẫu nhiên, không cần bạn điền gì."
fi

# ─────────────────────────── 4. .env — cổng chỉ bind localhost ───────────────────────────
# docker compose nội suy biến từ .env ở thư mục repo (KHÔNG phải .env.docker).
# Docker publish port đi vòng qua ufw, nên phải bind 127.0.0.1 chứ đừng trông chờ firewall.
step "Khoá cổng backend/DB vào 127.0.0.1"
touch .env
set_env_line() {
  local key="$1" val="$2"
  if grep -qE "^${key}=" .env; then sed -i "s|^${key}=.*|${key}=${val}|" .env; else echo "${key}=${val}" >> .env; fi
}
set_env_line FRONTEND_PORT "127.0.0.1:${APP_PORT}"
set_env_line BACKEND_PORT  "127.0.0.1:3001"
set_env_line DB_PORT       "127.0.0.1:55432"
# .env này bị nướng vào bundle frontend lúc build → tuyệt đối không để secret VITE_* ở đây.
if grep -qE '^VITE_.*SECRET=' .env; then
  warn "Trong .env có biến VITE_*SECRET — Vite nhúng thẳng vào JS công khai. Đang xoá."
  sed -i '/^VITE_.*SECRET=/d' .env
fi

# ─────────────────────────── 5. BUILD + CHẠY ───────────────────────────
step "Build image + khởi động stack (lần đầu ~vài phút)"
docker compose up -d --build

echo -n "Chờ backend healthy"
BACKEND_OK=0
for i in $(seq 1 60); do
  if docker compose exec -T backend curl -fsS http://localhost:3001/api/test >/dev/null 2>&1; then
    echo " OK"; BACKEND_OK=1; break
  fi
  echo -n "."; sleep 3
done
[ "$BACKEND_OK" = "1" ] || warn "Backend chưa healthy sau ~3 phút. Xem log:  cd $REPO_DIR && docker compose logs backend"

# ─────────────────────────── 6. NGINX ───────────────────────────
step "Cấu hình nginx reverse proxy → 127.0.0.1:${APP_PORT}"
VHOST="/etc/nginx/sites-available/tab-order-fetcher"
CERT_DIR="/etc/letsencrypt/live/${DOMAIN}"
[ -f "$VHOST" ] && cp "$VHOST" "${VHOST}.bak_$(date +%F_%H%M%S)"

proxy_block() {
  cat <<'BLOCK'
    location / {
        proxy_pass http://127.0.0.1:__APP_PORT__;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
    }
BLOCK
}

write_vhost() {
  local mode="$1"   # http | https
  {
    if [ "$mode" = "https" ]; then
      printf 'server {\n    listen 80;\n    server_name %s;\n    return 301 https://$host$request_uri;\n}\n' "$DOMAIN"
      printf 'server {\n    listen 443 ssl;\n    server_name %s;\n\n' "$DOMAIN"
      printf '    ssl_certificate     %s/fullchain.pem;\n' "$CERT_DIR"
      printf '    ssl_certificate_key %s/privkey.pem;\n' "$CERT_DIR"
    else
      printf 'server {\n    listen 80;\n    server_name %s;\n\n' "$DOMAIN"
    fi
    printf '    client_max_body_size 25m;\n\n'
    proxy_block | sed "s|__APP_PORT__|${APP_PORT}|"
    printf '}\n'
  } > "$VHOST"
}

reload_nginx() { nginx -t && systemctl reload nginx; }

if [ -f "${CERT_DIR}/fullchain.pem" ]; then
  write_vhost https
  echo "Dùng cert Let's Encrypt sẵn có tại ${CERT_DIR}."
else
  write_vhost http
fi
ln -sf "$VHOST" /etc/nginx/sites-enabled/tab-order-fetcher
rm -f /etc/nginx/sites-enabled/default
reload_nginx
echo "nginx OK"

step "Firewall (ufw)"
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null
echo "Mở 22/80/443. Cổng 3001/55432 đã bind 127.0.0.1 nên không lộ ra internet."

# ─────────────────────────── 7. TLS ───────────────────────────
TLS_DONE=0
[ -f "${CERT_DIR}/fullchain.pem" ] && TLS_DONE=1

if [ "$TLS_DONE" = "1" ]; then
  step "Chứng chỉ HTTPS đã có — bỏ qua Certbot (systemd timer tự gia hạn)"
elif [ "$SKIP_TLS" = "1" ]; then
  warn "Bỏ qua cấp cert (không có domain hoặc SKIP_TLS=1)."
else
  step "Cấp chứng chỉ HTTPS (Let's Encrypt)"
  DNS_IP="$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1{print $1}' || true)"
  if [ -n "$SERVER_IP" ] && [ -n "$DNS_IP" ] && [ "$SERVER_IP" != "$DNS_IP" ]; then
    warn "DNS của ${DOMAIN} trỏ về ${DNS_IP}, còn VPS này là ${SERVER_IP} → bỏ qua Certbot."
    warn "Sửa A record xong chạy:  sudo certbot --nginx -d ${DOMAIN} --redirect -m ${ADMIN_EMAIL} --agree-tos"
  elif certbot --nginx -d "$DOMAIN" --redirect --non-interactive --agree-tos -m "$ADMIN_EMAIL"; then
    write_vhost https      # viết lại vhost theo đúng khuôn của mình để lần chạy sau ổn định
    reload_nginx
    TLS_DONE=1
    echo "HTTPS OK"
  else
    warn "Certbot thất bại (DNS chưa lan, rate limit…). App vẫn chạy trên HTTP."
    warn "Thử lại:  sudo certbot --nginx -d ${DOMAIN} --redirect -m ${ADMIN_EMAIL} --agree-tos"
  fi
fi

# FRONTEND_URL/SHOPIFY_APP_URL trong .env.docker phải khớp scheme thật, nếu không OAuth redirect sai.
FINAL_PROTO="http"; [ "$TLS_DONE" = "1" ] && FINAL_PROTO="https"
FINAL_URL="${FINAL_PROTO}://${DOMAIN}"
if ! grep -qF "FRONTEND_URL=${FINAL_URL}" .env.docker; then
  step "Đồng bộ FRONTEND_URL/SHOPIFY_APP_URL = ${FINAL_URL}"
  sed -i "s|^FRONTEND_URL=.*|FRONTEND_URL=${FINAL_URL}|"     .env.docker
  sed -i "s|^SHOPIFY_APP_URL=.*|SHOPIFY_APP_URL=${FINAL_URL}|" .env.docker
  grep -qE '^SHOPIFY_APP_URL=' .env.docker || echo "SHOPIFY_APP_URL=${FINAL_URL}" >> .env.docker
  docker compose up -d
fi

# ─────────────────────────── 8. XONG ───────────────────────────
step "HOÀN TẤT"
docker compose ps

cat <<EOF

$(echo -e "${c_green}App: ${FINAL_URL}${c_reset}")

Việc cần làm tiếp:
  1. Mở app → ĐĂNG KÝ bằng đúng email ${ADMIN_EMAIL} → tự lên admin + ACTIVE.
     (Mọi user khác vào trạng thái PENDING chờ bạn duyệt.)
  2. Shopify Partner app → Allowed redirection URL:
       ${FINAL_URL}/api/shopify/oauth/callback
     (Shopify OAuth + webhook BẮT BUỘC HTTPS.)
  3. Muốn dùng app Shopify hệ thống / 17TRACK: điền SHOPIFY_CLIENT_ID,
     SHOPIFY_CLIENT_SECRET, TRACK17_API_KEY vào ${REPO_DIR}/.env.docker rồi:
       cd ${REPO_DIR} && docker compose up -d

Lệnh vận hành:
  cd ${REPO_DIR}
  docker compose logs -f backend                 # log
  docker compose ps                              # trạng thái
  git pull && docker compose up -d --build       # deploy bản mới (migration tự apply)
  docker compose exec -T db pg_dump -U postgres tab_order_fetcher > ~/backup_\$(date +%F).sql

$(echo -e "${c_yellow}Backup file ${REPO_DIR}/.env.docker — mất JWT_SECRET là hỏng toàn bộ token store đã lưu.${c_reset}")
EOF
