# Garage Admin

Web admin cho [Garage](https://garagehq.deuxfleurs.fr/) (object storage S3-compatible của Deuxfleurs), nhắm **Garage v2.x** (Admin API v2). Một **Go binary** biên dịch tĩnh nhúng sẵn frontend **React + Mantine**, đóng gói thành một Docker image nhỏ chạy tốt trên NAS **arm32v7 / 1GB RAM**.

> **Trạng thái:** Phase 1 (nền tảng) — đăng nhập đa người dùng có phân quyền, quản lý kết nối cluster, và dashboard sức khỏe cluster. Các phase sau bổ sung quản lý bucket, access key, layout cluster, node/block, admin token, và file browser.

## Tính năng (Phase 1)

- **Đăng nhập đa người dùng** với 2 vai trò: `admin` (toàn quyền) và `readonly` (chỉ xem). Session lưu SQLite, cookie httpOnly.
- **Quản lý kết nối cluster** (Settings): thêm/xóa nhiều cluster, chọn mặc định. Admin token & S3 secret được **mã hóa AES-256-GCM** khi lưu, không bao giờ lộ ra trình duyệt.
- **Dashboard** sức khỏe cluster (node connected/healthy, partitions, quorum) lấy trực tiếp từ Garage Admin API v2.
- **Đa theme**: 5 preset (Default, Ocean, Forest, Sunset, Mono) + chế độ sáng/tối.
- Mọi lời gọi Garage đi qua backend proxy → token không lộ ra client. Vai trò `readonly` bị chặn ở cả frontend lẫn backend.

## Kiến trúc

```
Browser (React + Mantine SPA)
        │  /api/*  (cookie session)
        ▼
Go binary (chi router)
        ├── phục vụ SPA tĩnh (go:embed)
        ├── SQLite (modernc, pure-Go): users, clusters, sessions
        ├── secret mã hóa AES-256-GCM (APP_SECRET_KEY)
        ├── Garage Admin API v2 client  ──►  http://<garage>:3903
        └── (sắp tới) S3 client          ──►  http://<garage>:3900
```

Toàn bộ mã nguồn nằm trong [`src/`](src/). Module Go root là `src/` (`src/go.mod`).

```
src/
├── cmd/garage-admin/        # entry point
├── internal/
│   ├── config/              # đọc env
│   ├── crypto/              # AES-256-GCM
│   ├── db/                  # SQLite + migrations + repositories
│   ├── auth/                # bcrypt, session, middleware phân quyền
│   ├── garage/              # client Admin API v2
│   ├── api/                 # HTTP handlers (auth, clusters, cluster status)
│   └── web/                 # go:embed dist + SPA fallback
└── web/                     # frontend Vite + React + Mantine (build → internal/web/dist)
```

## Cấu hình (biến môi trường)

| Biến | Bắt buộc | Mặc định | Mô tả |
|---|---|---|---|
| `APP_SECRET_KEY` | ✅ | — | Khóa mã hóa secret at-rest. **Phải đúng 32 byte.** |
| `APP_PORT` | | `8080` | Cổng HTTP |
| `APP_DB_PATH` | | `/data/app.db` | Đường dẫn file SQLite |
| `ADMIN_USER` | | — | Tài khoản admin khởi tạo (chỉ tạo nếu DB chưa có user nào) |
| `ADMIN_PASSWORD` | | — | Mật khẩu admin khởi tạo |

Nếu không đặt `ADMIN_USER`/`ADMIN_PASSWORD`, hãy tạo user admin đầu tiên bằng cách khác (sẽ có trang setup ở phase sau).

## Chạy bằng Docker

Image được CI build sẵn lên GHCR (multi-arch `linux/arm/v7` + `linux/amd64`):

```bash
docker run -d --name garage-admin -p 8080:8080 \
  -e APP_SECRET_KEY=<chuỗi-32-ký-tự> \
  -e ADMIN_USER=admin -e ADMIN_PASSWORD=<mật-khẩu> \
  -v /volume1/garage-admin:/data \
  ghcr.io/<owner>/garage-admin:main
```

Mở `http://<nas-ip>:8080`, đăng nhập, vào **Settings** thêm cluster (endpoint Admin API `http://<garage>:3903` + admin token), rồi xem **Dashboard**.

> Tạo `APP_SECRET_KEY` 32 byte: `openssl rand -hex 16` (32 ký tự hex).

## Phát triển

Yêu cầu: Go 1.25+, Node 22+.

**Backend** (từ `src/`):
```bash
cd src
go test ./...        # chạy toàn bộ test
go run ./cmd/garage-admin   # cần các env ở trên
```

**Frontend** (từ `src/web/`, chế độ dev với hot-reload, proxy /api sang backend ở :8080):
```bash
cd src/web
npm install
npm run dev          # http://localhost:5173
```

**Build production** (frontend → embed → binary):
```bash
cd src/web && npm run build      # xuất ra src/internal/web/dist
cd ..       && go build ./cmd/garage-admin
```

## Build Docker thủ công

```bash
docker buildx build --platform linux/arm/v7 -t garage-admin:armv7 --load .
```

## CI/CD

[`.github/workflows/docker.yml`](.github/workflows/docker.yml) build và push image multi-arch lên GHCR khi push lên `main` hoặc tạo tag `v*`. Tag image theo branch, phiên bản semver, và commit SHA.

## Tài liệu

- Spec thiết kế: [`docs/superpowers/specs/`](docs/superpowers/specs/)
- Kế hoạch triển khai: [`docs/superpowers/plans/`](docs/superpowers/plans/)
- [Garage Admin API v2](https://garagehq.deuxfleurs.fr/documentation/reference-manual/admin-api/)
