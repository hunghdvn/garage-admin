# Garage S3 Admin Website — Design

**Date:** 2026-06-09
**Status:** Approved design, pending implementation plan

## 1. Mục tiêu

Một website admin đầy đủ tính năng cho Garage (object storage S3-compatible của Deuxfleurs),
nhắm Garage **v2.x** (Admin API v2 kiểu RPC). Phủ **toàn bộ khả năng của Admin API v2**, cộng
file browser qua S3 API, dashboard tổng quan, đa theme, và multi-user có phân quyền.

Triển khai trên **NAS arm32v7, 1GB RAM**, đóng gói **Docker image** nhỏ gọn, build qua **GitHub Actions**.

Cluster dev/test: `http://192.168.101.8:3903` (Admin API).

## 2. Ràng buộc & Quyết định kiến trúc

| Ràng buộc | Quyết định |
|---|---|
| arm32v7, 1GB RAM | Backend **Go** biên dịch tĩnh (`CGO_ENABLED=0`, `GOARCH=arm GOARM=7`); RAM thấp, image nhỏ |
| 1 Docker image | Frontend tĩnh nhúng vào binary qua `go:embed`; 1 process duy nhất |
| Bảo mật token | Admin token & S3 secret **chỉ ở backend**, không lộ ra browser; mọi call đi qua proxy `/api/*` |
| Cross-compile sạch | SQLite dùng `modernc.org/sqlite` (pure-Go, không CGo) |
| Hiệu năng frontend | React chạy trong browser người dùng → không tốn RAM NAS |

**Stack:**
- Backend: Go + `chi` router + `modernc.org/sqlite` + AWS SDK Go v2 (S3) + `golang.org/x/crypto/bcrypt`
- Frontend: React + Vite + Mantine + TanStack Query + React Router
- Mã hóa secret at-rest: AES-256-GCM với master key từ env `APP_SECRET_KEY`

## 3. Kiến trúc tổng thể

```
┌─────────────────────────────────────────────────┐
│  Docker image (linux/arm/v7, ~20-30MB)           │
│  ┌─────────────────────────────────────────┐    │
│  │  Go binary (1 process, RAM thấp)         │    │
│  │   • HTTP server (chi router)             │    │
│  │   • Phục vụ SPA tĩnh (go:embed)          │    │
│  │   • REST API /api/* cho frontend         │    │
│  │   • Auth session (SQLite)                │    │
│  │   • Garage Admin API v2 client (proxy)   │────┼──► Garage Admin API (:3903)
│  │   • S3 client (file browser)             │────┼──► Garage S3 API (:3900)
│  │   • SQLite (modernc, pure-Go)            │    │
│  └─────────────────────────────────────────┘    │
│  Volume: /data/app.db (SQLite)                   │
└─────────────────────────────────────────────────┘
```

## 4. Cấu trúc module (Go)

Mỗi module một nhiệm vụ rõ ràng, có interface, test độc lập:

| Module | Nhiệm vụ | Phụ thuộc |
|---|---|---|
| `cmd/garage-admin` | Entry point, wiring | tất cả |
| `internal/config` | Đọc env (port, `APP_SECRET_KEY`, db path, bootstrap admin) | — |
| `internal/db` | SQLite, migrations, repository (users, clusters, sessions) | config |
| `internal/crypto` | AES-256-GCM encrypt/decrypt secret at-rest | config |
| `internal/auth` | Login, session cookie httpOnly, middleware role-check | db, crypto |
| `internal/garage` | Client Admin API v2 (typed methods, cho mọi endpoint) | — |
| `internal/s3` | Wrapper S3 cho file browser (list/put/get/delete/multipart) | — |
| `internal/api` | HTTP handlers theo nhóm | tất cả internal |
| `internal/web` | go:embed dist frontend + SPA fallback | — |
| `web/` | Source frontend (Vite + React + Mantine) | — |

**Boundaries:** `garage` và `s3` không biết gì về HTTP/DB — thuần client. `api` orchestrate.
`db` không biết về HTTP. Có thể test `garage` client bằng httptest server giả lập Garage.

## 5. Mô hình dữ liệu (SQLite)

```
users      (id, username UNIQUE, password_hash, role['admin'|'readonly'], created_at, updated_at)
clusters   (id, name, admin_endpoint, admin_token_enc,
            s3_endpoint, s3_region, s3_access_key, s3_secret_key_enc,
            is_default, created_at, updated_at)
sessions   (token PK, user_id FK, created_at, expires_at)
```

- Secret (`admin_token_enc`, `s3_secret_key_enc`) mã hóa AES-256-GCM bằng `APP_SECRET_KEY`.
- Session lưu DB → thu hồi được; cookie `httpOnly`, `SameSite=Lax`, `Secure` (khi HTTPS).
- **Bootstrap**: lần chạy đầu chưa có user → tạo admin từ env `ADMIN_USER`/`ADMIN_PASSWORD`,
  hoặc hiển thị trang setup tạo admin đầu tiên nếu env trống.

## 6. Phủ toàn bộ Admin API v2 → Trang & tính năng

### Dashboard
- `GetClusterHealth`, `GetClusterStatus`, `GetClusterStatistics`
- Hiển thị: trạng thái cluster, số node connected/healthy, dung lượng, partition status, tổng bucket/key.

### Buckets
- `ListBuckets`, `GetBucketInfo`, `CreateBucket`, `UpdateBucket/{id}`, `DeleteBucket`
- Alias: `AddBucketAlias`, `RemoveBucketAlias` (global & local)
- Quota & website config (qua `UpdateBucket`), website ↔ CORS rules
- `CleanupIncompleteUploads` (dọn multipart dở)
- `InspectObject` (xem chi tiết internal của object)

### Bucket detail
- Quyền key trên bucket: `Allow/DenyBucketKey`
- File browser (S3) nhúng trong trang bucket

### Access Keys
- `ListKeys`, `GetKeyInfo` (tùy chọn lộ secret), `CreateKey`, `UpdateKey/{id}`, `DeleteKey`, `ImportKey`
- Quyền & expiration; gán quyền bucket qua `Allow/DenyBucketKey`

### Cluster & Layout
- `GetClusterStatus` (danh sách node), `GetClusterHealth`
- Layout workflow: `GetClusterLayout` → `UpdateClusterLayout` (stage) → `PreviewClusterLayoutChanges`
  → `ApplyClusterLayout` / `RevertClusterLayout`
- `GetClusterLayoutHistory`, `ConnectClusterNodes`

### Node maintenance (đầy đủ)
- `GetNodeInfo/{node}`, `GetNodeStatistics/{node}`
- `CreateMetadataSnapshot/{node}`, `LaunchRepairOperation/{node}`
- Workers: `ListWorkers/{node}`, `GetWorkerInfo/{node}`, `GetWorkerVariable/{node}`, `SetWorkerVariable/{node}`

### Block management
- `GetBlockInfo/{node}`, `ListBlockErrors/{node}`, `RetryBlockResync/{node}`, `PurgeBlocks/{node}`

### Admin Tokens
- `ListAdminTokens`, `GetAdminTokenInfo`, `GetCurrentAdminTokenInfo`,
  `CreateAdminToken`, `UpdateAdminToken/{id}`, `DeleteAdminToken/{id}`

### File browser (S3 API)
- Duyệt theo prefix/delimiter (ListObjectsV2), upload (PutObject + multipart cho file lớn),
  download (presigned URL hoặc stream qua backend), xóa, tạo "folder" (zero-byte prefix)
- Credential S3 lấy từ cấu hình cluster (Settings)

### Settings
- Quản lý nhiều **cluster connections** (endpoint Admin + S3, token, region), chọn cluster mặc định
- Selector đổi cluster đang thao tác

### Users (chỉ Admin)
- CRUD user, gán role admin/readonly, reset mật khẩu

### Profile / Theme
- Đổi mật khẩu bản thân, chọn theme

## 7. Phân quyền

Hai role: **Admin** (toàn quyền) và **Read-only** (chỉ xem).
- Frontend: ẩn/khóa nút tạo/sửa/xóa với readonly.
- Backend: middleware chặn method thay đổi (POST/PUT/DELETE nghiệp vụ) nếu role readonly — **defense in depth**, không tin frontend.

## 8. Theming

Mantine: light/dark + nhiều preset dựng sẵn (đổi `primaryColor`, `defaultRadius`, font).
Preset gợi ý: **Default, Ocean, Forest, Sunset, Mono**. Toggle light/dark. Lưu lựa chọn vào localStorage.

## 9. API nội bộ (frontend ↔ backend)

REST dưới `/api`:
- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `GET/POST/PUT/DELETE /api/clusters...` (Settings)
- `GET/POST/PUT/DELETE /api/users...`
- Proxy nghiệp vụ Garage theo cluster đang chọn: `/api/buckets`, `/api/keys`, `/api/cluster`,
  `/api/nodes`, `/api/blocks`, `/api/admin-tokens`, `/api/files` (S3)
- Cluster đang chọn truyền qua header/`?cluster=` hoặc lưu trong session.

Backend không expose raw token; nhận id cluster → tra DB → giải mã → gọi Garage.

## 10. Build & Deploy

**Dockerfile multi-stage:**
1. `node:lts` → `npm ci && vite build` → `web/dist`
2. `golang:x` → copy `web/dist` vào thư mục embed → `CGO_ENABLED=0 GOARCH=arm GOARM=7 go build -ldflags="-s -w"`
3. `alpine` (kèm `ca-certificates`) hoặc `scratch` → copy binary, `EXPOSE 8080`, `VOLUME /data`

**Env runtime:** `APP_PORT`, `APP_SECRET_KEY` (bắt buộc), `APP_DB_PATH=/data/app.db`,
`ADMIN_USER`, `ADMIN_PASSWORD` (bootstrap, tùy chọn).

**GitHub Actions** (`.github/workflows/docker.yml`):
- Trigger: push tag `v*` và push `main`
- `docker/setup-qemu-action` + `docker/setup-buildx-action`
- Build `--platform linux/arm/v7` (cân nhắc thêm `linux/amd64` để test)
- Login & push **GHCR** (`ghcr.io/<owner>/garage-admin`), tag theo git tag + `sha` + `latest`
- Cache layer bằng GitHub Actions cache

## 11. Phân kỳ triển khai

Mỗi phase chạy được, validate trên cluster thật `192.168.101.8:3903`:

1. **Nền tảng**: skeleton Go + embed SPA, SQLite + migrations, auth/session, middleware role,
   Settings cluster (CRUD + mã hóa secret), Garage client v2 cơ bản (`GetClusterStatus/Health`),
   Dockerfile arm/v7 + GitHub Actions.
2. **Buckets + Access Keys**: CRUD đầy đủ, alias, quota, website/CORS, quyền key.
3. **Cluster + Layout**: status, node list, layout workflow, history, connect node.
4. **Node maintenance + Block management + Admin Tokens**: phần nâng cao đầy đủ.
5. **File browser** (S3): list/upload/download/delete/folder/multipart.
6. **Dashboard + Theming + Users + đánh bóng**: dashboard tổng hợp, theme switcher, quản lý user, polish UX.

## 12. Testing

- Go: unit test cho `crypto`, `auth`, `garage` (httptest giả lập Garage v2), `db` (SQLite tạm).
- Frontend: test component trọng yếu (form tạo bucket/key, layout workflow).
- Smoke test thủ công trên cluster thật mỗi cuối phase.

## 13. Ngoài phạm vi (YAGNI)

- RBAC chi tiết (chỉ 2 role).
- Metrics dashboard nâng cao kiểu Grafana (đã có `/metrics` Prometheus của Garage riêng).
- Multi-tenant / tổ chức.
