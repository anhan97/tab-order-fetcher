#!/usr/bin/env bash
#
# connect_caddy.sh — Đấu app này vào Caddy ĐANG CHẠY của app khác trên cùng VPS.
#
# Dùng khi cổng 80/443 đã bị một container proxy khác giữ (deploy_vps.sh sẽ báo
# EXTERNAL_PROXY). Tắt proxy đó = sập app kia, nên thay vì tranh cổng, ta thêm
# một site block vào Caddy để nó phục vụ luôn domain của app này.
#
#   cd /var/www/tab-order-fetcher
#   sudo DOMAIN=app.adumie.com bash connect_caddy.sh
#
# Script tự dò: container Caddy, file Caddyfile thật (mount ra host hay nằm
# trong image), network Docker của app, tên container frontend.
#
# An toàn: backup Caddyfile trước khi sửa, `caddy validate` trước khi reload,
# hỏng thì tự khôi phục. Chạy lại nhiều lần được (domain đã có thì bỏ qua).
#
set -euo pipefail

DOMAIN="${DOMAIN:-}"
CADDY_CT="${CADDY_CT:-}"          # để trống = tự tìm container đang giữ cổng 80
UPSTREAM="${UPSTREAM:-}"          # để trống = tự lấy container frontend của compose ở thư mục này
REPO_DIR="${REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"

c_green="\033[0;32m"; c_yellow="\033[1;33m"; c_red="\033[0;31m"; c_reset="\033[0m"
step() { echo -e "\n${c_green}==> $*${c_reset}"; }
warn() { echo -e "${c_yellow}!  $*${c_reset}"; }
die()  { echo -e "${c_red}x  $*${c_reset}" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Chạy bằng root:  sudo DOMAIN=app.adumie.com bash connect_caddy.sh"
[ -n "$DOMAIN" ]     || die "Thiếu DOMAIN. Ví dụ:  sudo DOMAIN=app.adumie.com bash connect_caddy.sh"
command -v docker >/dev/null || die "Không thấy docker."

# ─────────────────── 1. Tìm container proxy đang giữ cổng 80 ───────────────────
step "Tìm proxy đang giữ cổng 80"
if [ -z "$CADDY_CT" ]; then
  CADDY_CT="$(docker ps --format '{{.Names}} {{.Ports}}' | grep -E '0\.0\.0\.0:80->' | awk '{print $1}' | head -1 || true)"
fi
[ -n "$CADDY_CT" ] || die "Không thấy container nào publish cổng 80. Cổng 80 trống thì dùng nginx host (deploy_vps.sh lo)."
echo "Proxy: $CADDY_CT"
docker exec "$CADDY_CT" caddy version >/dev/null 2>&1 \
  || die "$CADDY_CT không phải Caddy (không chạy được 'caddy version'). Traefik/nginx-proxy thì phải cấu hình theo cách riêng."

# ─────────────────── 2. Tìm frontend + network của app này ───────────────────
step "Xác định upstream của app này"
cd "$REPO_DIR"
[ -f docker-compose.yml ] || die "Không thấy docker-compose.yml trong $REPO_DIR."
FRONTEND_ID="$(docker compose ps -q frontend 2>/dev/null | head -1 || true)"
[ -n "$FRONTEND_ID" ] || die "Container frontend chưa chạy. Chạy deploy_vps.sh trước."
FRONTEND_CT="$(docker inspect -f '{{.Name}}' "$FRONTEND_ID" | sed 's|^/||')"
APP_NET="$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$FRONTEND_ID" | awk '{print $1}')"
[ -n "$UPSTREAM" ] || UPSTREAM="${FRONTEND_CT}:80"
echo "Upstream: $UPSTREAM   (network: $APP_NET)"

# ─────────────────── 3. Cho Caddy vào chung network ───────────────────
step "Nối $CADDY_CT vào network $APP_NET"
if docker network connect "$APP_NET" "$CADDY_CT" 2>/dev/null; then
  echo "Đã nối."
else
  docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$CADDY_CT" | grep -qw "$APP_NET" \
    && echo "Đã nằm sẵn trong network — bỏ qua." \
    || die "Không nối được vào network $APP_NET."
fi
# Caddy phải phân giải được tên container thì reverse_proxy mới chạy.
docker exec "$CADDY_CT" sh -c "getent hosts ${UPSTREAM%%:*} >/dev/null" \
  || warn "Caddy chưa phân giải được '${UPSTREAM%%:*}'. Nếu reload lỗi, thử: docker restart $CADDY_CT"

# ─────────────────── 4. Tìm file Caddyfile thật ───────────────────
step "Tìm Caddyfile đang được nạp"
CFG="$(docker inspect -f '{{json .Config.Cmd}} {{json .Args}}' "$CADDY_CT" \
       | tr ',' '\n' | grep -A1 -- '--config' | tail -1 | tr -d '"[]' | tr -d ' ' || true)"
case "$CFG" in /*) ;; *) CFG="/etc/caddy/Caddyfile" ;; esac
docker exec "$CADDY_CT" test -f "$CFG" || die "Không thấy file cấu hình $CFG trong container."
echo "Config: $CFG"

# Mount ra host không? Nếu có thì sửa file trên host để lần rebuild sau vẫn còn.
HOST_CFG=""
while IFS='|' read -r src dst; do
  [ -z "$dst" ] && continue
  if [ "$dst" = "$CFG" ]; then HOST_CFG="$src"; break; fi
  case "$CFG" in "$dst"/*) HOST_CFG="${src}${CFG#$dst}" ;; esac
done < <(docker inspect -f '{{range .Mounts}}{{.Source}}|{{.Destination}}{{"\n"}}{{end}}' "$CADDY_CT")

if [ -n "$HOST_CFG" ] && [ -f "$HOST_CFG" ]; then
  echo "Caddyfile mount từ host: $HOST_CFG  → sửa trực tiếp file này."
else
  HOST_CFG=""
  warn "Caddyfile nằm TRONG image (không mount ra host)."
  warn "Sửa trong container thì reload/restart vẫn còn, nhưng rebuild image là mất."
  warn "Nhớ thêm khối bên dưới vào Caddyfile trong source của app kia rồi build lại."
fi

# ─────────────────── 5. Đã có domain chưa? ───────────────────
if docker exec "$CADDY_CT" grep -qE "^[[:space:]]*${DOMAIN}[[:space:],{]" "$CFG"; then
  step "Caddyfile đã có ${DOMAIN} — không thêm lại"
  docker exec "$CADDY_CT" caddy reload --adapter caddyfile --config "$CFG" \
    && echo "Đã reload Caddy." || warn "Reload lỗi — xem: docker logs --tail 50 $CADDY_CT"
  exit 0
fi

# ─────────────────── 6. Thêm site block + validate + reload ───────────────────
step "Thêm site block cho ${DOMAIN} → ${UPSTREAM}"
STAMP="$(date +%F_%H%M%S)"
BLOCK="$(printf '\n# ── Thêm bởi connect_caddy.sh (%s) — Order Manager ──\n%s {\n    encode zstd gzip\n    reverse_proxy %s\n}\n' "$STAMP" "$DOMAIN" "$UPSTREAM")"

# Backup: luôn giữ một bản trong container để rollback được ở mọi trường hợp.
BAK_IN="${CFG}.bak_${STAMP}"
docker exec "$CADDY_CT" cp "$CFG" "$BAK_IN"
echo "Backup trong container: $BAK_IN"

restore() {
  warn "Khôi phục Caddyfile từ backup."
  docker exec "$CADDY_CT" cp "$BAK_IN" "$CFG" || true
  [ -n "$HOST_CFG" ] && [ -f "${HOST_CFG}.bak_${STAMP}" ] && cp "${HOST_CFG}.bak_${STAMP}" "$HOST_CFG"
  docker exec "$CADDY_CT" caddy reload --adapter caddyfile --config "$CFG" >/dev/null 2>&1 || true
}

if [ -n "$HOST_CFG" ]; then
  cp "$HOST_CFG" "${HOST_CFG}.bak_${STAMP}"
  echo "Backup trên host: ${HOST_CFG}.bak_${STAMP}"
  printf '%s' "$BLOCK" >> "$HOST_CFG"
else
  printf '%s' "$BLOCK" | docker exec -i "$CADDY_CT" sh -c "cat >> '$CFG'"
fi

step "Kiểm tra cú pháp"
if ! docker exec "$CADDY_CT" caddy validate --adapter caddyfile --config "$CFG"; then
  restore
  die "Caddyfile không hợp lệ — đã khôi phục bản cũ, app kia không bị ảnh hưởng."
fi

step "Reload Caddy"
if ! docker exec "$CADDY_CT" caddy reload --adapter caddyfile --config "$CFG"; then
  restore
  die "Reload thất bại — đã khôi phục. Xem log:  docker logs --tail 50 $CADDY_CT"
fi

# ─────────────────── 7. Đồng bộ URL trong .env.docker ───────────────────
step "Đồng bộ FRONTEND_URL/SHOPIFY_APP_URL = https://${DOMAIN}"
if [ -f .env.docker ]; then
  sed -i "s|^FRONTEND_URL=.*|FRONTEND_URL=https://${DOMAIN}|" .env.docker
  if grep -qE '^SHOPIFY_APP_URL=' .env.docker; then
    sed -i "s|^SHOPIFY_APP_URL=.*|SHOPIFY_APP_URL=https://${DOMAIN}|" .env.docker
  else
    echo "SHOPIFY_APP_URL=https://${DOMAIN}" >> .env.docker
  fi
  docker compose up -d
else
  warn "Không thấy .env.docker — bỏ qua bước đồng bộ URL."
fi

step "XONG"
cat <<EOF

Caddy giờ phục vụ:
  • domain cũ của app kia (không đụng tới)
  • https://${DOMAIN}  →  ${UPSTREAM}

Kiểm tra (cert lần đầu mất ~10-30s để Caddy xin xong):
  curl -I https://${DOMAIN}
  docker logs --tail 30 ${CADDY_CT}

Việc còn lại:
  1. Mở https://${DOMAIN} → đăng ký bằng email ADMIN_EMAIL trong .env.docker.
  2. Shopify Partner → Allowed redirection URL:
       https://${DOMAIN}/api/shopify/oauth/callback

Nếu 'curl' báo lỗi cert: kiểm tra A record của ${DOMAIN} đã trỏ về VPS này chưa,
Caddy chỉ xin được cert khi domain đã phân giải đúng.
EOF
if [ -z "$HOST_CFG" ]; then
  warn "NHẮC LẠI: Caddyfile nằm trong image. Thêm khối này vào source của app kia rồi build lại,"
  warn "không thì lần rebuild tới sẽ mất cấu hình vừa thêm:"
  printf '%s\n' "$BLOCK"
fi
