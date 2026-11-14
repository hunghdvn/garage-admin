<div align="center">

# Garage Admin

**A lightweight, self-hosted web console for [Garage](https://garagehq.deuxfleurs.fr/) S3-compatible object storage.**

**English** · [Tiếng Việt](README.vi.md)

[![Build image](https://github.com/hunghdvn/garage-admin/actions/workflows/docker.yml/badge.svg)](https://github.com/hunghdvn/garage-admin/actions/workflows/docker.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Garage](https://img.shields.io/badge/Garage-v2.x%20(Admin%20API%20v2)-orange)](https://garagehq.deuxfleurs.fr/documentation/reference-manual/admin-api/)
[![Platforms](https://img.shields.io/badge/image-linux%2Famd64%20%7C%20linux%2Farm%2Fv7-informational)](https://github.com/hunghdvn/garage-admin/pkgs/container/garage-admin)

</div>

Garage Admin manages one or more Garage clusters from the browser: buckets, access keys,
files, cluster layout, nodes and admin tokens. It ships as a **single static Go binary**
with the **React + Mantine** UI embedded, packaged in a small Docker image that runs
comfortably on low-power hardware such as a **32-bit ARM NAS with 1 GB of RAM**.

## Contents

- [Features](#features)
- [Compatibility](#compatibility)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Security](#security)
- [Architecture](#architecture)
- [Development](#development)
- [Container images](#container-images)
- [Contributing](#contributing)
- [License](#license)

## Features

**Cluster**
- Health dashboard: status, connected nodes, partitions, free space, bucket and object totals
- Node list with zone, capacity, disk usage and resync queue
- Layout management: stage role changes, preview with capacity statistics, apply, revert, history
- Connect new nodes to the cluster
- Usage history: hourly snapshots of used/free space and object count, charted per hour (24 h) or per day (7 days – 1 year)

**Buckets**
- List with object count, size, quota and key count; create and delete
- Global and local aliases, per-key read / write / owner permissions
- Quotas (max size, max objects), static website hosting, CORS rules
- Clean up incomplete multipart uploads, inspect objects
- Per-bucket size and object-count history chart

**Access keys**
- Create (with optional expiry) or import keys; the secret is shown once on creation
- Bucket access overview, `createBucket` permission, revealing the secret (admins only)

**Files**
- Browse buckets through the S3 API: upload, download, create folders, rename, delete folders recursively

**Operations**
- Admin tokens: create, scope, expire, revoke
- Node maintenance: node info, statistics, background workers and their variables,
  metadata snapshots, repair jobs, block errors (retry / purge), block lookup

**Access control & UI**
- Multiple users with `admin` (full access) and `readonly` (view only) roles, enforced on the server
- Multiple clusters, switchable from the header
- Light / dark mode and several theme presets

## Compatibility

| Component | Supported |
|---|---|
| Garage | **v2.x** (Admin API v2). Tested against v2.5.0. |
| Garage ≥ v2.4 | Layout preview/apply statistics, extended node information |
| Garage ≥ v2.5 | Detailed bucket and key lists in a single call, resync queue per node, client connection parameters. On older v2 releases the lists fall back to the basic endpoints automatically. |
| Container platforms | `linux/amd64`, `linux/arm/v7` |

Garage v1.x (Admin API v1) is not supported.

## Quick start

### 1. Generate a secret key

`APP_SECRET_KEY` encrypts the stored cluster credentials. Use a **64-character hex string**
(decoded to a 32-byte key):

```bash
openssl rand -hex 32    # prints 64 hex characters
```

> Keep this value safe and **never change it** once the app is in use: credentials
> stored with the old key can no longer be decrypted. Existing deployments keep working
> with their current key (an exactly-32-byte string is still accepted as the raw key).

### 2. Run the container

```bash
docker run -d --name garage-admin \
  -p 8080:8080 \
  -e APP_SECRET_KEY=<64-hex-character-secret> \
  -e ADMIN_USER=admin \
  -e ADMIN_PASSWORD=<strong-initial-password> \
  -v "$(pwd)/garage-admin-data:/data" \
  --restart unless-stopped \
  ghcr.io/hunghdvn/garage-admin:latest
```

Or with Docker Compose, next to Garage on the same network:

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

The container runs as a non-root user (uid/gid `10001`); on start the entrypoint fixes the
ownership of `/data`, so volumes created by earlier root-based images keep working.

### 3. Connect a cluster

1. Open `http://<host>:8080` and sign in with `ADMIN_USER` / `ADMIN_PASSWORD`
   (used only to create the first account; change the password afterwards under **Profile**).
2. Go to **Settings → Cluster connections** and add:
   - **Admin endpoint**: Garage's admin API, e.g. `http://garage:3903`
   - **Admin token**: the `admin_token` from `garage.toml`, or a scoped admin token
   - *(optional, for the Files page)* **S3 endpoint**, **region**, **access key** and **secret key**

## Configuration

| Variable | Required | Default | Description |
|---|:---:|---|---|
| `APP_SECRET_KEY` | ✅ | — | Encryption key for stored secrets: 64 hex characters (recommended, `openssl rand -hex 32`) or, for backward compatibility, an exactly-32-byte string used as the raw key. |
| `APP_PORT` | | `8080` | HTTP listen port |
| `APP_DB_PATH` | | `/data/app.db` | SQLite database path |
| `ADMIN_USER` | | — | Initial admin username; only used when the database has no users |
| `ADMIN_PASSWORD` | | — | Initial admin password. Use a strong one (passwords must be 8–72 characters; a shorter value still bootstraps but logs a warning) |
| `APP_COOKIE_SECURE` | | `false` | Set to `true` when served over HTTPS so the session cookie is marked `Secure` |
| `APP_TRUSTED_ORIGINS` | | — | Comma-separated extra origins allowed to make state-changing requests, e.g. `https://admin.example.com`. Only needed when a reverse proxy rewrites the `Host` header and the UI is not served over HTTPS/localhost; otherwise leave unset |
| `APP_TRUST_PROXY` | | `false` | When `true`, the client IP for login rate limiting is taken from the right-most `X-Forwarded-For` entry. Enable only when the app is reachable exclusively through a reverse proxy you control |

A health endpoint is available at `GET /api/health`.

## Security

- Garage admin tokens and S3 secrets are encrypted at rest with **AES-256-GCM** and are
  never sent to the browser; every Garage call goes through the backend.
- Passwords (8–72 characters) are hashed with **bcrypt**. Sessions last 24 hours and use an
  `HttpOnly`, `SameSite=Lax` cookie; session tokens are stored hashed (SHA-256) in the database.
  Changing or resetting a password signs out that user's other sessions. All users are signed
  out once after upgrading to this version.
- Login is rate limited: 5 failed attempts per 15 minutes per IP + username and 30 per IP;
  further attempts get HTTP 429.
- Cross-origin state-changing requests are rejected (CSRF protection based on `Sec-Fetch-Site`
  / Origin vs Host); see `APP_TRUSTED_ORIGINS`.
- Security headers (CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`) are sent on
  every response.
- Changing a cluster's admin endpoint requires re-entering its admin token.
- The `readonly` role is enforced by the API, not only hidden in the UI. It cannot change
  anything, but it **can** browse and download objects on the Files page (using the cluster's
  stored S3 key) and view admin-token metadata (never token secrets).
- The container runs as a non-root user.

Recommendations:

- Expose the app only over **HTTPS** (reverse proxy or tunnel) and set `APP_COOKIE_SECURE=true`.
- Do **not** expose Garage's admin API (port `3903`) publicly; only Garage Admin needs to reach it.
- Prefer a dedicated, scoped admin token over the global `admin_token` where possible.
- Choose a strong `ADMIN_PASSWORD`; give `readonly` accounts only to people who may read the
  stored data, and use an S3 key scoped to the buckets that should be browsable.
- Set `APP_TRUST_PROXY=true` only behind a reverse proxy you control.

## Architecture

```
Browser (React + Mantine SPA)
        │  /api/*  (session cookie)
        ▼
Go binary (chi router)
        ├── embedded SPA (go:embed)
        ├── SQLite (modernc.org/sqlite, pure Go): users, sessions, clusters
        ├── AES-256-GCM secret store (APP_SECRET_KEY)
        ├── Garage Admin API v2 client  ──►  http://<garage>:3903
        └── S3 client (minio-go)        ──►  http://<garage>:3900
```

```
src/
├── cmd/garage-admin/   # entry point
├── internal/
│   ├── api/            # HTTP handlers
│   ├── auth/           # bcrypt, sessions, role middleware
│   ├── config/         # environment configuration
│   ├── crypto/         # AES-256-GCM
│   ├── db/             # SQLite, migrations, repositories
│   ├── garage/         # Garage Admin API v2 client
│   ├── s3/             # S3 client for the file browser
│   └── web/            # embedded frontend (dist/) with SPA fallback
└── web/                # Vite + React + Mantine frontend
```

## Development

Requirements: **Go 1.25+**, **Node.js 22+**.

```bash
# Backend (from src/)
cd src
go test ./...
APP_SECRET_KEY=$(openssl rand -hex 32) ADMIN_USER=admin ADMIN_PASSWORD=dev-password-123 \
APP_DB_PATH=./dev.db go run ./cmd/garage-admin          # http://localhost:8080

# Frontend with hot reload (from src/web/), proxies /api to :8080
cd src/web
npm install
npm run dev                                             # http://localhost:5173
```

Production build: the frontend is compiled into `src/internal/web/dist` and embedded in the binary.

```bash
cd src/web && npm run build
cd ..      && go build -o garage-admin ./cmd/garage-admin
```

## Container images

Images are built by [GitHub Actions](.github/workflows/docker.yml) and published to
`ghcr.io/hunghdvn/garage-admin` for `linux/amd64` and `linux/arm/v7`.

| Tag | Updated on |
|---|---|
| `latest`, `main` | every push to `main` |
| `sha-<commit>` | every build; immutable, good for pinning |
| `<major>.<minor>.<patch>` | `v*` release tags |

Build locally:

```bash
docker buildx build --platform linux/amd64,linux/arm/v7 -t garage-admin .
```

## Contributing

Issues and pull requests are welcome. Before opening a PR:

1. Run `go test ./...` in `src/` and `npx tsc -b` in `src/web/`.
2. If you changed the UI, run `npm run build` in `src/web/` and commit the updated
   `src/internal/web/dist` (it is embedded in the binary and tracked on purpose).

## License

Released under the [MIT License](LICENSE).

Garage is developed by [Deuxfleurs](https://deuxfleurs.fr/). This project is an
independent community tool and is not affiliated with or endorsed by Deuxfleurs.
