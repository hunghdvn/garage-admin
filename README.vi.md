<div align="center">

# Garage Admin

**Giao diện quản trị web gọn nhẹ, tự host, dành cho hệ thống lưu trữ object tương thích S3 [Garage](https://garagehq.deuxfleurs.fr/).**

[English](README.md) · **Tiếng Việt**

[![Build image](https://github.com/hunghdvn/garage-admin/actions/workflows/docker.yml/badge.svg)](https://github.com/hunghdvn/garage-admin/actions/workflows/docker.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Garage](https://img.shields.io/badge/Garage-v2.x%20(Admin%20API%20v2)-orange)](https://garagehq.deuxfleurs.fr/documentation/reference-manual/admin-api/)
[![Platforms](https://img.shields.io/badge/image-linux%2Famd64%20%7C%20linux%2Farm%2Fv7-informational)](https://github.com/hunghdvn/garage-admin/pkgs/container/garage-admin)

</div>

Garage Admin cho phép quản lý một hoặc nhiều cluster Garage ngay trên trình duyệt: bucket,
access key, file, layout cluster, node và admin token. Ứng dụng là **một binary Go biên dịch
tĩnh** nhúng sẵn giao diện **React + Mantine**, đóng gói trong Docker image nhỏ gọn, chạy tốt
trên phần cứng yếu như **NAS ARM 32-bit với 1 GB RAM**.

## Mục lục

- [Tính năng](#tính-năng)
- [Tương thích](#tương-thích)
- [Bắt đầu nhanh](#bắt-đầu-nhanh)
- [Cấu hình](#cấu-hình)
- [Bảo mật](#bảo-mật)
- [Kiến trúc](#kiến-trúc)
- [Phát triển](#phát-triển)
- [Container image](#container-image)
- [Đóng góp](#đóng-góp)
- [Giấy phép](#giấy-phép)

## Tính năng

**Cluster**
- Dashboard sức khỏe: trạng thái, số node kết nối, partition, dung lượng trống, tổng bucket và object
- Danh sách node kèm zone, capacity, dung lượng đĩa và hàng đợi resync
- Quản lý layout: stage thay đổi role, preview kèm thống kê dung lượng, apply, revert, lịch sử
- Kết nối node mới vào cluster

**Bucket**
- Danh sách kèm số object, dung lượng, quota và số key; tạo và xoá bucket
- Alias toàn cục và alias cục bộ, phân quyền đọc / ghi / owner cho từng key
- Quota (dung lượng tối đa, số object tối đa), static website hosting, CORS
- Dọn multipart upload dang dở, tra cứu object

**Access key**
- Tạo key (có thể đặt hạn dùng) hoặc import key có sẵn; secret chỉ hiển thị một lần khi tạo
- Xem bucket mà key được truy cập, quyền `createBucket`, xem lại secret (chỉ admin)

**File**
- Duyệt bucket qua S3 API: tải lên, tải xuống, tạo thư mục, đổi tên, xoá thư mục đệ quy

**Vận hành**
- Admin token: tạo, giới hạn scope, đặt hạn dùng, thu hồi
- Bảo trì node: thông tin node, thống kê, worker chạy nền và biến cấu hình của worker,
  snapshot metadata, chạy repair, block lỗi (retry / purge), tra cứu block

**Phân quyền & giao diện**
- Nhiều người dùng với hai vai trò `admin` (toàn quyền) và `readonly` (chỉ xem), kiểm soát ở phía server
- Nhiều cluster, chuyển đổi ngay trên thanh header
- Chế độ sáng / tối và nhiều theme có sẵn

## Tương thích

| Thành phần | Hỗ trợ |
|---|---|
| Garage | **v2.x** (Admin API v2). Đã kiểm thử với v2.5.0. |
| Garage ≥ v2.4 | Thống kê khi preview/apply layout, thông tin node mở rộng |
| Garage ≥ v2.5 | Danh sách bucket và key đầy đủ chi tiết trong một lần gọi, hàng đợi resync từng node, thông số kết nối cho client. Với các bản v2 cũ hơn, danh sách tự động quay về endpoint cơ bản. |
| Nền tảng container | `linux/amd64`, `linux/arm/v7` |

Không hỗ trợ Garage v1.x (Admin API v1).

## Bắt đầu nhanh

### 1. Tạo khoá bí mật

`APP_SECRET_KEY` phải dài **đúng 32 byte**, dùng để mã hoá thông tin đăng nhập cluster được lưu lại.

```bash
openssl rand -hex 16    # in ra 32 ký tự hex
```

> Hãy cất giữ giá trị này cẩn thận và **không bao giờ thay đổi** sau khi đã sử dụng: thông tin
> đã mã hoá bằng khoá cũ sẽ không thể giải mã được nữa.

### 2. Chạy container

```bash
docker run -d --name garage-admin \
  -p 8080:8080 \
  -e APP_SECRET_KEY=<chuỗi-bí-mật-32-ký-tự> \
  -e ADMIN_USER=admin \
  -e ADMIN_PASSWORD=<mật-khẩu-ban-đầu> \
  -v "$(pwd)/garage-admin-data:/data" \
  --restart unless-stopped \
  ghcr.io/hunghdvn/garage-admin:latest
```

Hoặc dùng Docker Compose, chạy cùng mạng với Garage:

```yaml
services:
  garage-admin:
    image: ghcr.io/hunghdvn/garage-admin:latest
    restart: unless-stopped
    ports:
      - "8080:8080"
    env_file: .env          # APP_SECRET_KEY, ADMIN_USER, ADMIN_PASSWORD
    volumes:
      - ./data:/data
```

### 3. Kết nối cluster

1. Mở `http://<host>:8080` và đăng nhập bằng `ADMIN_USER` / `ADMIN_PASSWORD`
   (chỉ dùng để tạo tài khoản đầu tiên; sau đó hãy đổi mật khẩu trong **Profile**).
2. Vào **Settings → Cluster connections** và thêm:
   - **Admin endpoint**: địa chỉ admin API của Garage, ví dụ `http://garage:3903`
   - **Admin token**: giá trị `admin_token` trong `garage.toml`, hoặc một admin token có giới hạn scope
   - *(tuỳ chọn, cho trang Files)* **S3 endpoint**, **region**, **access key** và **secret key**

## Cấu hình

| Biến | Bắt buộc | Mặc định | Mô tả |
|---|:---:|---|---|
| `APP_SECRET_KEY` | ✅ | — | Khoá mã hoá secret được lưu. Phải đúng 32 byte. |
| `APP_PORT` | | `8080` | Cổng HTTP |
| `APP_DB_PATH` | | `/data/app.db` | Đường dẫn file SQLite |
| `ADMIN_USER` | | — | Tài khoản admin ban đầu; chỉ dùng khi database chưa có người dùng nào |
| `ADMIN_PASSWORD` | | — | Mật khẩu admin ban đầu |
| `APP_COOKIE_SECURE` | | `false` | Đặt `true` khi chạy qua HTTPS để cookie phiên được gắn cờ `Secure` |

Endpoint kiểm tra sức khỏe: `GET /api/health`.

## Bảo mật

- Admin token của Garage và S3 secret được mã hoá khi lưu bằng **AES-256-GCM** và không bao giờ
  gửi xuống trình duyệt; mọi lời gọi tới Garage đều đi qua backend.
- Mật khẩu được băm bằng **bcrypt**. Phiên đăng nhập kéo dài 24 giờ, dùng cookie `HttpOnly`,
  `SameSite=Lax`.
- Vai trò `readonly` được kiểm soát ở API, không chỉ ẩn trên giao diện.

Khuyến nghị:

- Chỉ public ứng dụng qua **HTTPS** (reverse proxy hoặc tunnel) và đặt `APP_COOKIE_SECURE=true`.
- **Không** public admin API của Garage (cổng `3903`); chỉ Garage Admin cần truy cập cổng này.
- Nên dùng một admin token riêng, giới hạn scope, thay cho `admin_token` toàn cục khi có thể.

## Kiến trúc

```
Trình duyệt (React + Mantine SPA)
        │  /api/*  (cookie phiên)
        ▼
Go binary (chi router)
        ├── SPA nhúng sẵn (go:embed)
        ├── SQLite (modernc.org/sqlite, thuần Go): users, sessions, clusters
        ├── kho secret AES-256-GCM (APP_SECRET_KEY)
        ├── client Garage Admin API v2  ──►  http://<garage>:3903
        └── client S3 (minio-go)        ──►  http://<garage>:3900
```

```
src/
├── cmd/garage-admin/   # entry point
├── internal/
│   ├── api/            # HTTP handler
│   ├── auth/           # bcrypt, phiên, middleware phân quyền
│   ├── config/         # cấu hình từ biến môi trường
│   ├── crypto/         # AES-256-GCM
│   ├── db/             # SQLite, migration, repository
│   ├── garage/         # client Garage Admin API v2
│   ├── s3/             # client S3 cho trình duyệt file
│   └── web/            # frontend nhúng (dist/) với SPA fallback
└── web/                # frontend Vite + React + Mantine
```

## Phát triển

Yêu cầu: **Go 1.25+**, **Node.js 22+**.

```bash
# Backend (trong src/)
cd src
go test ./...
APP_SECRET_KEY=$(openssl rand -hex 16) ADMIN_USER=admin ADMIN_PASSWORD=admin \
APP_DB_PATH=./dev.db go run ./cmd/garage-admin          # http://localhost:8080

# Frontend có hot reload (trong src/web/), proxy /api sang :8080
cd src/web
npm install
npm run dev                                             # http://localhost:5173
```

Build production: frontend được build vào `src/internal/web/dist` rồi nhúng vào binary.

```bash
cd src/web && npm run build
cd ..      && go build -o garage-admin ./cmd/garage-admin
```

## Container image

Image được [GitHub Actions](.github/workflows/docker.yml) build và đẩy lên
`ghcr.io/hunghdvn/garage-admin` cho `linux/amd64` và `linux/arm/v7`.

| Tag | Cập nhật khi |
|---|---|
| `latest`, `main` | mỗi lần push lên `main` |
| `sha-<commit>` | mỗi lần build; không thay đổi, phù hợp để ghim phiên bản |
| `<major>.<minor>.<patch>` | khi tạo tag phát hành `v*` |

Build thủ công:

```bash
docker buildx build --platform linux/amd64,linux/arm/v7 -t garage-admin .
```

## Đóng góp

Mọi issue và pull request đều được chào đón. Trước khi mở PR:

1. Chạy `go test ./...` trong `src/` và `npx tsc -b` trong `src/web/`.
2. Nếu có thay đổi giao diện, chạy `npm run build` trong `src/web/` và commit cả thư mục
   `src/internal/web/dist` (thư mục này được nhúng vào binary và cố ý đưa vào git).

## Giấy phép

Phát hành theo [giấy phép MIT](LICENSE).

Garage được phát triển bởi [Deuxfleurs](https://deuxfleurs.fr/). Dự án này là công cụ cộng đồng
độc lập, không liên kết và không được Deuxfleurs bảo trợ.
