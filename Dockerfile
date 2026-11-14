# syntax=docker/dockerfile:1

# Build stages run natively on the build host ($BUILDPLATFORM) and cross-compile
# the Go binary for each target, so multi-arch builds need no QEMU emulation
# except for the tiny runtime stage.

# --- Stage 1: build frontend (architecture-independent) ---
FROM --platform=$BUILDPLATFORM node:22-alpine AS frontend
WORKDIR /app
COPY src/web/package.json src/web/package-lock.json ./web/
RUN cd web && npm ci
COPY src/web ./web
# Vite outDir is ../internal/web/dist (relative to web/), so this writes /app/internal/web/dist.
RUN cd web && npm run build

# --- Stage 2: cross-compile Go binary for the target platform ---
FROM --platform=$BUILDPLATFORM golang:1.25-alpine AS backend
WORKDIR /src
COPY src/go.mod src/go.sum ./
RUN go mod download
COPY src/ ./
# Overwrite the embedded dist with the freshly built frontend so go:embed picks it up.
COPY --from=frontend /app/internal/web/dist ./internal/web/dist
ARG TARGETARCH
ARG TARGETVARIANT
RUN CGO_ENABLED=0 GOOS=linux GOARCH=${TARGETARCH} \
    GOARM=$(echo "${TARGETVARIANT}" | tr -d 'v') \
    go build -ldflags="-s -w" -o /out/garage-admin ./cmd/garage-admin

# --- Stage 3: runtime ---
FROM alpine:3.22
# Fixed UID/GID so file ownership on the /data volume is stable across rebuilds.
RUN apk add --no-cache ca-certificates su-exec \
    && addgroup -g 10001 -S garage \
    && adduser -u 10001 -S -D -H -G garage -s /sbin/nologin garage \
    && mkdir -p /data && chown garage:garage /data
COPY --from=backend /out/garage-admin /usr/local/bin/garage-admin
# Starts as root only to fix /data ownership, then drops to the garage user.
COPY --chmod=0755 docker/entrypoint.sh /usr/local/bin/entrypoint.sh
ENV APP_PORT=8080 APP_DB_PATH=/data/app.db
EXPOSE 8080
VOLUME /data
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
