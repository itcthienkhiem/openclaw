# OpenClaw Multi-Tenant Proxy

Lớp proxy đa người dùng cho OpenClaw. **Không chỉnh sửa bất kỳ file nào của openclaw** — chỉ wrap nó từ bên ngoài.

## Nguyên lý hoạt động

```
Client A (API key A) ──┐
Client B (API key B) ──┤──► MT Proxy :3000 ──► openclaw instance A :port_A
Client C (API key C) ──┘                   └──► openclaw instance B :port_B
                                            └──► openclaw instance C :port_C
```

- Mỗi tenant có một **openclaw instance riêng** với state directory và gateway token riêng biệt
- Instance được khởi động **lazy** (lần đầu có request) và tự dừng sau thời gian idle
- Khi openclaw nâng cấp, chỉ cần build lại binary/image — code multi-tenant không bị ảnh hưởng

## Cài đặt nhanh

```bash
cd multi-tenant
cp .env.example .env
# Điền MT_ADMIN_KEY vào .env (bắt buộc):
echo "MT_ADMIN_KEY=$(openssl rand -hex 32)" >> .env

pnpm install
```

### process mode (không cần Docker)

Build openclaw trước:
```bash
# Trong thư mục gốc openclaw:
pnpm build
```

Chạy proxy:
```bash
cd multi-tenant
pnpm dev      # development
pnpm start    # production (sau khi pnpm build)
```

### docker mode

```bash
# Trong .env: MT_MODE=docker, OPENCLAW_IMAGE=openclaw:local
# Build openclaw image:
docker build -t openclaw:local ..

cd multi-tenant
pnpm dev
```

## Quản lý tenant

```bash
# Tạo tenant mới
MT_ADMIN_KEY=<key> pnpm tenant create "Công ty A" "admin@congty-a.vn"
# → trả về { id, apiKey } — lưu apiKey lại

# Liệt kê tất cả tenant
MT_ADMIN_KEY=<key> pnpm tenant list

# Vô hiệu hóa tenant
MT_ADMIN_KEY=<key> pnpm tenant disable <id>

# Xem instance đang chạy
MT_ADMIN_KEY=<key> pnpm tenant instances

# Dừng instance (tự khởi động lại khi có request tiếp theo)
MT_ADMIN_KEY=<key> pnpm tenant stop-instance <id>

# Đổi API key
MT_ADMIN_KEY=<key> pnpm tenant rotate-key <id>
```

## Sử dụng (phía client)

Tenant dùng API key của mình như Bearer token:

```bash
# Chat qua OpenAI-compatible endpoint
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer mt_<your_api_key>" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-3-5-sonnet","messages":[{"role":"user","content":"Xin chào!"}]}'

# Hoặc qua X-Api-Key header
curl http://localhost:3000/healthz \
  -H "X-Api-Key: mt_<your_api_key>"
```

## Admin API (HTTP)

Tất cả admin routes yêu cầu header `X-Admin-Key`.

| Method | Path | Mô tả |
|--------|------|-------|
| `GET` | `/healthz` | Liveness probe |
| `POST` | `/admin/tenants` | Tạo tenant (`{name, email}`) |
| `GET` | `/admin/tenants` | Liệt kê tenant |
| `DELETE` | `/admin/tenants/:id` | Vô hiệu hóa tenant |
| `POST` | `/admin/tenants/:id/rotate-key` | Đổi API key |
| `GET` | `/admin/instances` | Instance đang chạy |
| `POST` | `/admin/instances/:id/stop` | Dừng instance |

## Cấu hình (Environment Variables)

| Biến | Mặc định | Mô tả |
|------|----------|-------|
| `MT_PORT` | `3000` | Port proxy lắng nghe |
| `MT_ADMIN_KEY` | *(bắt buộc)* | Secret key cho admin API |
| `MT_DB_PATH` | `./data/tenants.db` | SQLite DB |
| `MT_TENANTS_DIR` | `./data/tenants` | Thư mục state per-tenant |
| `MT_MODE` | `process` | `process` hoặc `docker` |
| `MT_IDLE_TIMEOUT_MS` | `1800000` | Tự dừng instance sau X ms idle |
| `OPENCLAW_NODE_BIN` | `node` | Node binary (process mode) |
| `OPENCLAW_MAIN` | `../dist/index.js` | Path openclaw entry (process mode) |
| `OPENCLAW_IMAGE` | `openclaw:local` | Docker image (docker mode) |

## Nâng cấp OpenClaw

**Process mode:**
```bash
# 1. Trong thư mục openclaw gốc:
git pull && pnpm install && pnpm build
# 2. Restart proxy:
pnpm start
# Instances cũ tự dừng, khởi động lại với binary mới khi có request
```

**Docker mode:**
```bash
# 1. Build image mới:
docker build -t openclaw:local ..
# 2. Restart proxy:
docker compose restart openclaw-mt-proxy
# Instances mới sẽ dùng image mới
```

**Code multi-tenant trong thư mục này không bị ảnh hưởng.**

## Kiến trúc thư mục

```
multi-tenant/            ← toàn bộ code ở đây, không phụ thuộc openclaw source
├── src/
│   ├── index.ts         ← HTTP server + WebSocket proxy
│   ├── config.ts        ← cấu hình từ env vars
│   ├── db.ts            ← SQLite tenant registry
│   ├── manager.ts       ← lifecycle openclaw instances (process/docker)
│   └── proxy.ts         ← HTTP + WebSocket reverse proxy
├── scripts/
│   └── cli.ts           ← admin CLI
├── data/                ← runtime data (gitignored)
│   ├── tenants.db       ← tenant registry
│   └── tenants/
│       ├── {id-A}/      ← state dir tenant A
│       └── {id-B}/      ← state dir tenant B
├── docker-compose.yml
├── Dockerfile
└── .env.example
```
