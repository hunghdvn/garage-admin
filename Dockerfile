# syntax=docker/dockerfile:1

# --- Stage 1: build frontend ---
FROM node:22-alpine AS frontend
WORKDIR /app
COPY src/web/package.json src/web/package-lock.json ./web/
RUN cd web && npm ci
COPY src/web ./web
# Vite outDir is ../internal/web/dist (relative to web/), so this writes /app/internal/web/dist.
RUN cd web && npm run build

# --- Stage 2: build Go binary ---
FROM golang:1.25-alpine AS backend
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
FROM alpine:3.20
RUN apk add --no-cache ca-certificates && mkdir -p /data
COPY --from=backend /out/garage-admin /usr/local/bin/garage-admin
ENV APP_PORT=8080 APP_DB_PATH=/data/app.db
EXPOSE 8080
VOLUME /data
ENTRYPOINT ["/usr/local/bin/garage-admin"]
