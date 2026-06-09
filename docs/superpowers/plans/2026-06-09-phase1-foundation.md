# Phase 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the runnable foundation of the Garage admin website — a single Go binary that embeds a React+Mantine SPA, stores users/clusters/sessions in SQLite (secrets encrypted at rest), authenticates users with sessions and roles, talks to the Garage v2 Admin API, and ships as an `arm/v7` Docker image built by GitHub Actions.

**Architecture:** Go backend (`chi` router) serves a `go:embed`-ed Vite/React/Mantine SPA and a `/api/*` REST surface. SQLite (`modernc.org/sqlite`, pure-Go) holds data; AES-256-GCM encrypts cluster secrets using `APP_SECRET_KEY`. A typed Garage Admin API v2 client proxies cluster calls. After Phase 1 the app can log in, manage cluster connections, and show live cluster status from `http://192.168.101.8:3903`.

**Tech Stack:** Go 1.22+, `github.com/go-chi/chi/v5`, `modernc.org/sqlite`, `golang.org/x/crypto/bcrypt`, `github.com/stretchr/testify`; React + TypeScript + Vite + Mantine v7 + `@tanstack/react-query` + `react-router-dom` + `axios`. Docker `buildx` (`linux/arm/v7`), GitHub Actions → GHCR.

**Module path:** `github.com/HungHD/garage-admin` (adjust if the GitHub repo differs).

**Verification note:** Frontend UI is verified with the **Playwright MCP** browser tools (`browser_navigate`, `browser_snapshot`, `browser_type`, `browser_click`, `browser_take_screenshot`) against the locally running binary, in addition to any unit tests.

---

## File Structure

```
garage-admin/
├── go.mod, go.sum
├── .gitignore
├── Dockerfile
├── .github/workflows/docker.yml
├── cmd/garage-admin/main.go            # entry point, wiring
├── internal/
│   ├── config/config.go                # env config + tests
│   ├── crypto/crypto.go                # AES-256-GCM encrypt/decrypt + tests
│   ├── db/
│   │   ├── db.go                       # open sqlite + run migrations
│   │   ├── migrations/0001_init.sql    # schema (embedded)
│   │   ├── users.go                    # users repository
│   │   ├── clusters.go                 # clusters repository (encrypts secrets)
│   │   └── sessions.go                 # sessions repository
│   ├── auth/
│   │   ├── password.go                 # bcrypt hash/verify
│   │   └── session.go                  # session service + middleware
│   ├── garage/client.go                # Garage Admin API v2 client
│   ├── api/
│   │   ├── server.go                   # router wiring, helpers (JSON, errors)
│   │   ├── auth.go                     # /api/auth/* handlers
│   │   ├── clusters.go                 # /api/clusters CRUD handlers
│   │   └── cluster_status.go           # /api/cluster/status proxy
│   └── web/embed.go                    # go:embed dist + SPA fallback
└── web/                                # frontend (Vite)
    ├── package.json, vite.config.ts, tsconfig.json, index.html
    └── src/
        ├── main.tsx, App.tsx
        ├── api/client.ts               # axios instance
        ├── theme/themes.ts             # Mantine theme presets
        ├── auth/AuthContext.tsx
        ├── components/AppShell.tsx, ThemeSwitcher.tsx
        └── pages/LoginPage.tsx, DashboardPage.tsx, SettingsPage.tsx
```

---

## Task 0: Project scaffolding

**Files:**
- Create: `go.mod`, `.gitignore`

- [ ] **Step 1: Initialize Go module**

Run:
```bash
cd /Users/hunghd/Repositories/garage-admin
go mod init github.com/HungHD/garage-admin
```
Expected: creates `go.mod` with `go 1.22` (or installed version).

- [ ] **Step 2: Add `.gitignore`**

Create `.gitignore`:
```
/garage-admin
/tmp
*.db
*.db-shm
*.db-wal
web/dist/
web/node_modules/
.env
```

- [ ] **Step 3: Add dependencies**

Run:
```bash
go get github.com/go-chi/chi/v5
go get modernc.org/sqlite
go get golang.org/x/crypto/bcrypt
go get github.com/stretchr/testify
```
Expected: `go.mod`/`go.sum` updated.

- [ ] **Step 4: Commit**

```bash
git add go.mod go.sum .gitignore
git commit -m "chore: initialize Go module and dependencies"
```

---

## Task 1: Config package

**Files:**
- Create: `internal/config/config.go`
- Test: `internal/config/config_test.go`

- [ ] **Step 1: Write the failing test**

Create `internal/config/config_test.go`:
```go
package config

import "testing"

func TestLoadDefaults(t *testing.T) {
	t.Setenv("APP_SECRET_KEY", "0123456789abcdef0123456789abcdef")
	t.Setenv("APP_PORT", "")
	t.Setenv("APP_DB_PATH", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Port != "8080" {
		t.Errorf("Port = %q, want 8080", cfg.Port)
	}
	if cfg.DBPath != "/data/app.db" {
		t.Errorf("DBPath = %q, want /data/app.db", cfg.DBPath)
	}
	if len(cfg.SecretKey) != 32 {
		t.Errorf("SecretKey len = %d, want 32", len(cfg.SecretKey))
	}
}

func TestLoadRequiresSecret(t *testing.T) {
	t.Setenv("APP_SECRET_KEY", "")
	if _, err := Load(); err == nil {
		t.Fatal("expected error when APP_SECRET_KEY missing")
	}
}

func TestLoadSecretMustBe32Bytes(t *testing.T) {
	t.Setenv("APP_SECRET_KEY", "tooshort")
	if _, err := Load(); err == nil {
		t.Fatal("expected error when APP_SECRET_KEY is not 32 bytes")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/config/`
Expected: FAIL (build error — `Load`/`Config` undefined).

- [ ] **Step 3: Write minimal implementation**

Create `internal/config/config.go`:
```go
// Package config loads runtime configuration from environment variables.
package config

import (
	"errors"
	"os"
)

// Config holds runtime configuration.
type Config struct {
	Port      string
	DBPath    string
	SecretKey []byte // 32 bytes, used for AES-256-GCM
	AdminUser string // optional bootstrap admin username
	AdminPass string // optional bootstrap admin password
}

// Load reads configuration from the environment.
// APP_SECRET_KEY is required and must be exactly 32 bytes.
func Load() (*Config, error) {
	secret := os.Getenv("APP_SECRET_KEY")
	if secret == "" {
		return nil, errors.New("APP_SECRET_KEY is required")
	}
	if len(secret) != 32 {
		return nil, errors.New("APP_SECRET_KEY must be exactly 32 bytes")
	}

	cfg := &Config{
		Port:      getenv("APP_PORT", "8080"),
		DBPath:    getenv("APP_DB_PATH", "/data/app.db"),
		SecretKey: []byte(secret),
		AdminUser: os.Getenv("ADMIN_USER"),
		AdminPass: os.Getenv("ADMIN_PASSWORD"),
	}
	return cfg, nil
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/config/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/config/
git commit -m "feat: add config package"
```

---

## Task 2: Crypto package (AES-256-GCM)

**Files:**
- Create: `internal/crypto/crypto.go`
- Test: `internal/crypto/crypto_test.go`

- [ ] **Step 1: Write the failing test**

Create `internal/crypto/crypto_test.go`:
```go
package crypto

import "testing"

var key = []byte("0123456789abcdef0123456789abcdef") // 32 bytes

func TestRoundTrip(t *testing.T) {
	c, err := New(key)
	if err != nil {
		t.Fatal(err)
	}
	plain := "super-secret-admin-token"
	enc, err := c.Encrypt(plain)
	if err != nil {
		t.Fatal(err)
	}
	if enc == plain {
		t.Fatal("ciphertext equals plaintext")
	}
	dec, err := c.Decrypt(enc)
	if err != nil {
		t.Fatal(err)
	}
	if dec != plain {
		t.Errorf("Decrypt = %q, want %q", dec, plain)
	}
}

func TestEncryptIsNondeterministic(t *testing.T) {
	c, _ := New(key)
	a, _ := c.Encrypt("x")
	b, _ := c.Encrypt("x")
	if a == b {
		t.Error("expected different ciphertexts due to random nonce")
	}
}

func TestDecryptRejectsTampered(t *testing.T) {
	c, _ := New(key)
	if _, err := c.Decrypt("not-valid-base64-!!!"); err == nil {
		t.Error("expected error decrypting garbage")
	}
}

func TestNewRejectsWrongKeyLength(t *testing.T) {
	if _, err := New([]byte("short")); err == nil {
		t.Error("expected error for non-32-byte key")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/crypto/`
Expected: FAIL (build error — `New` undefined).

- [ ] **Step 3: Write minimal implementation**

Create `internal/crypto/crypto.go`:
```go
// Package crypto encrypts and decrypts secrets at rest using AES-256-GCM.
package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"io"
)

// Cipher encrypts and decrypts short secret strings.
type Cipher struct {
	gcm cipher.AEAD
}

// New creates a Cipher from a 32-byte key.
func New(key []byte) (*Cipher, error) {
	if len(key) != 32 {
		return nil, errors.New("key must be 32 bytes")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &Cipher{gcm: gcm}, nil
}

// Encrypt returns a base64 string of nonce+ciphertext.
func (c *Cipher) Encrypt(plain string) (string, error) {
	nonce := make([]byte, c.gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	ct := c.gcm.Seal(nonce, nonce, []byte(plain), nil)
	return base64.StdEncoding.EncodeToString(ct), nil
}

// Decrypt reverses Encrypt.
func (c *Cipher) Decrypt(enc string) (string, error) {
	raw, err := base64.StdEncoding.DecodeString(enc)
	if err != nil {
		return "", err
	}
	ns := c.gcm.NonceSize()
	if len(raw) < ns {
		return "", errors.New("ciphertext too short")
	}
	nonce, ct := raw[:ns], raw[ns:]
	plain, err := c.gcm.Open(nil, nonce, ct, nil)
	if err != nil {
		return "", err
	}
	return string(plain), nil
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/crypto/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/crypto/
git commit -m "feat: add AES-256-GCM crypto package"
```

---

## Task 3: Database open + migrations

**Files:**
- Create: `internal/db/db.go`, `internal/db/migrations/0001_init.sql`
- Test: `internal/db/db_test.go`

- [ ] **Step 1: Write the migration SQL**

Create `internal/db/migrations/0001_init.sql`:
```sql
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('admin','readonly')),
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clusters (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    name              TEXT NOT NULL,
    admin_endpoint    TEXT NOT NULL,
    admin_token_enc   TEXT NOT NULL,
    s3_endpoint       TEXT NOT NULL DEFAULT '',
    s3_region         TEXT NOT NULL DEFAULT 'garage',
    s3_access_key     TEXT NOT NULL DEFAULT '',
    s3_secret_key_enc TEXT NOT NULL DEFAULT '',
    is_default        INTEGER NOT NULL DEFAULT 0,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);
```

- [ ] **Step 2: Write the failing test**

Create `internal/db/db_test.go`:
```go
package db

import (
	"path/filepath"
	"testing"
)

func TestOpenRunsMigrations(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.db")
	d, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()

	// Each table should be queryable after migration.
	for _, table := range []string{"users", "clusters", "sessions"} {
		var name string
		err := d.SQL().QueryRow(
			"SELECT name FROM sqlite_master WHERE type='table' AND name=?", table,
		).Scan(&name)
		if err != nil {
			t.Errorf("table %q not found: %v", table, err)
		}
	}
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `go test ./internal/db/`
Expected: FAIL (build error — `Open` undefined).

- [ ] **Step 4: Write minimal implementation**

Create `internal/db/db.go`:
```go
// Package db opens the SQLite database and runs embedded migrations.
package db

import (
	"database/sql"
	"embed"
	"fmt"
	"sort"

	_ "modernc.org/sqlite"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

// DB wraps the SQL connection.
type DB struct {
	sql *sql.DB
}

// Open opens (creating if needed) the SQLite database and applies migrations.
func Open(path string) (*DB, error) {
	conn, err := sql.Open("sqlite", path+"?_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)")
	if err != nil {
		return nil, err
	}
	conn.SetMaxOpenConns(1) // SQLite: single writer avoids lock churn on low-RAM NAS
	d := &DB{sql: conn}
	if err := d.migrate(); err != nil {
		conn.Close()
		return nil, err
	}
	return d, nil
}

// SQL exposes the underlying *sql.DB for repositories.
func (d *DB) SQL() *sql.DB { return d.sql }

// Close closes the connection.
func (d *DB) Close() error { return d.sql.Close() }

func (d *DB) migrate() error {
	entries, err := migrationsFS.ReadDir("migrations")
	if err != nil {
		return err
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		names = append(names, e.Name())
	}
	sort.Strings(names)
	for _, name := range names {
		content, err := migrationsFS.ReadFile("migrations/" + name)
		if err != nil {
			return err
		}
		if _, err := d.sql.Exec(string(content)); err != nil {
			return fmt.Errorf("migration %s: %w", name, err)
		}
	}
	return nil
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `go test ./internal/db/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add internal/db/
git commit -m "feat: add SQLite open and migrations"
```

---

## Task 4: Users repository

**Files:**
- Create: `internal/db/users.go`
- Test: `internal/db/users_test.go`

- [ ] **Step 1: Write the failing test**

Create `internal/db/users_test.go`:
```go
package db

import (
	"path/filepath"
	"testing"
)

func newTestDB(t *testing.T) *DB {
	t.Helper()
	d, err := Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	return d
}

func TestCreateAndGetUser(t *testing.T) {
	d := newTestDB(t)
	u, err := d.CreateUser("alice", "hash123", "admin")
	if err != nil {
		t.Fatal(err)
	}
	if u.ID == 0 {
		t.Error("expected non-zero ID")
	}
	got, err := d.GetUserByUsername("alice")
	if err != nil {
		t.Fatal(err)
	}
	if got.Username != "alice" || got.Role != "admin" || got.PasswordHash != "hash123" {
		t.Errorf("unexpected user: %+v", got)
	}
}

func TestCreateUserDuplicate(t *testing.T) {
	d := newTestDB(t)
	if _, err := d.CreateUser("bob", "h", "admin"); err != nil {
		t.Fatal(err)
	}
	if _, err := d.CreateUser("bob", "h", "admin"); err == nil {
		t.Error("expected duplicate username error")
	}
}

func TestListAndCountUsers(t *testing.T) {
	d := newTestDB(t)
	d.CreateUser("a", "h", "admin")
	d.CreateUser("b", "h", "readonly")
	n, err := d.CountUsers()
	if err != nil || n != 2 {
		t.Fatalf("CountUsers = %d, %v; want 2", n, err)
	}
	list, err := d.ListUsers()
	if err != nil || len(list) != 2 {
		t.Fatalf("ListUsers len = %d, %v; want 2", len(list), err)
	}
}

func TestDeleteUser(t *testing.T) {
	d := newTestDB(t)
	u, _ := d.CreateUser("c", "h", "admin")
	if err := d.DeleteUser(u.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := d.GetUserByUsername("c"); err == nil {
		t.Error("expected user to be gone")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/db/ -run TestCreateAndGetUser`
Expected: FAIL (build error — methods undefined).

- [ ] **Step 3: Write minimal implementation**

Create `internal/db/users.go`:
```go
package db

import (
	"database/sql"
	"errors"
	"time"
)

// User is an admin-panel user account.
type User struct {
	ID           int64
	Username     string
	PasswordHash string
	Role         string
	CreatedAt    string
	UpdatedAt    string
}

// ErrNotFound is returned when a row does not exist.
var ErrNotFound = errors.New("not found")

func nowRFC3339() string { return time.Now().UTC().Format(time.RFC3339) }

// CreateUser inserts a new user.
func (d *DB) CreateUser(username, passwordHash, role string) (*User, error) {
	now := nowRFC3339()
	res, err := d.sql.Exec(
		`INSERT INTO users (username, password_hash, role, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?)`,
		username, passwordHash, role, now, now,
	)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return &User{ID: id, Username: username, PasswordHash: passwordHash, Role: role, CreatedAt: now, UpdatedAt: now}, nil
}

// GetUserByUsername fetches a user by username.
func (d *DB) GetUserByUsername(username string) (*User, error) {
	return d.scanUser(d.sql.QueryRow(
		`SELECT id, username, password_hash, role, created_at, updated_at FROM users WHERE username=?`, username))
}

// GetUserByID fetches a user by id.
func (d *DB) GetUserByID(id int64) (*User, error) {
	return d.scanUser(d.sql.QueryRow(
		`SELECT id, username, password_hash, role, created_at, updated_at FROM users WHERE id=?`, id))
}

func (d *DB) scanUser(row *sql.Row) (*User, error) {
	var u User
	err := row.Scan(&u.ID, &u.Username, &u.PasswordHash, &u.Role, &u.CreatedAt, &u.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// ListUsers returns all users ordered by id.
func (d *DB) ListUsers() ([]User, error) {
	rows, err := d.sql.Query(
		`SELECT id, username, password_hash, role, created_at, updated_at FROM users ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []User
	for rows.Next() {
		var u User
		if err := rows.Scan(&u.ID, &u.Username, &u.PasswordHash, &u.Role, &u.CreatedAt, &u.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

// CountUsers returns the number of users.
func (d *DB) CountUsers() (int, error) {
	var n int
	err := d.sql.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&n)
	return n, err
}

// DeleteUser removes a user by id.
func (d *DB) DeleteUser(id int64) error {
	_, err := d.sql.Exec(`DELETE FROM users WHERE id=?`, id)
	return err
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/db/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/db/users.go internal/db/users_test.go
git commit -m "feat: add users repository"
```

---

## Task 5: Clusters repository (encrypted secrets)

**Files:**
- Create: `internal/db/clusters.go`
- Test: `internal/db/clusters_test.go`

The repository stores plaintext secrets in/out; encryption is applied by the API layer
(Task 12) via `crypto.Cipher`. The repo persists whatever string it's given into the
`*_enc` columns. This keeps `db` free of crypto dependency and keeps boundaries clean.

- [ ] **Step 1: Write the failing test**

Create `internal/db/clusters_test.go`:
```go
package db

import "testing"

func sampleCluster() *Cluster {
	return &Cluster{
		Name:           "local",
		AdminEndpoint:  "http://192.168.101.8:3903",
		AdminTokenEnc:  "enc-token",
		S3Endpoint:     "http://192.168.101.8:3900",
		S3Region:       "garage",
		S3AccessKey:    "GKxxxx",
		S3SecretKeyEnc: "enc-secret",
		IsDefault:      true,
	}
}

func TestCreateAndGetCluster(t *testing.T) {
	d := newTestDB(t)
	c, err := d.CreateCluster(sampleCluster())
	if err != nil {
		t.Fatal(err)
	}
	if c.ID == 0 {
		t.Fatal("expected id")
	}
	got, err := d.GetCluster(c.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.AdminEndpoint != "http://192.168.101.8:3903" || got.AdminTokenEnc != "enc-token" {
		t.Errorf("unexpected cluster: %+v", got)
	}
}

func TestListClustersAndDefault(t *testing.T) {
	d := newTestDB(t)
	d.CreateCluster(sampleCluster())
	second := sampleCluster()
	second.Name = "remote"
	second.IsDefault = false
	d.CreateCluster(second)

	list, err := d.ListClusters()
	if err != nil || len(list) != 2 {
		t.Fatalf("ListClusters len=%d err=%v", len(list), err)
	}
	def, err := d.GetDefaultCluster()
	if err != nil {
		t.Fatal(err)
	}
	if def.Name != "local" {
		t.Errorf("default = %q, want local", def.Name)
	}
}

func TestUpdateAndDeleteCluster(t *testing.T) {
	d := newTestDB(t)
	c, _ := d.CreateCluster(sampleCluster())
	c.Name = "renamed"
	if err := d.UpdateCluster(c); err != nil {
		t.Fatal(err)
	}
	got, _ := d.GetCluster(c.ID)
	if got.Name != "renamed" {
		t.Errorf("name = %q, want renamed", got.Name)
	}
	if err := d.DeleteCluster(c.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := d.GetCluster(c.ID); err == nil {
		t.Error("expected cluster gone")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/db/ -run Cluster`
Expected: FAIL (build error).

- [ ] **Step 3: Write minimal implementation**

Create `internal/db/clusters.go`:
```go
package db

import (
	"database/sql"
	"errors"
)

// Cluster is a stored Garage cluster connection. Token/secret fields hold
// already-encrypted values.
type Cluster struct {
	ID             int64
	Name           string
	AdminEndpoint  string
	AdminTokenEnc  string
	S3Endpoint     string
	S3Region       string
	S3AccessKey    string
	S3SecretKeyEnc string
	IsDefault      bool
	CreatedAt      string
	UpdatedAt      string
}

// CreateCluster inserts a cluster. If IsDefault, clears the flag on others.
func (d *DB) CreateCluster(c *Cluster) (*Cluster, error) {
	now := nowRFC3339()
	if c.IsDefault {
		if _, err := d.sql.Exec(`UPDATE clusters SET is_default=0`); err != nil {
			return nil, err
		}
	}
	res, err := d.sql.Exec(
		`INSERT INTO clusters
		 (name, admin_endpoint, admin_token_enc, s3_endpoint, s3_region, s3_access_key, s3_secret_key_enc, is_default, created_at, updated_at)
		 VALUES (?,?,?,?,?,?,?,?,?,?)`,
		c.Name, c.AdminEndpoint, c.AdminTokenEnc, c.S3Endpoint, c.S3Region,
		c.S3AccessKey, c.S3SecretKeyEnc, boolToInt(c.IsDefault), now, now,
	)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	c.ID, c.CreatedAt, c.UpdatedAt = id, now, now
	return c, nil
}

// GetCluster fetches by id.
func (d *DB) GetCluster(id int64) (*Cluster, error) {
	return d.scanCluster(d.sql.QueryRow(clusterSelect+` WHERE id=?`, id))
}

// GetDefaultCluster returns the default cluster, or any cluster if none flagged.
func (d *DB) GetDefaultCluster() (*Cluster, error) {
	c, err := d.scanCluster(d.sql.QueryRow(clusterSelect + ` WHERE is_default=1 LIMIT 1`))
	if errors.Is(err, ErrNotFound) {
		return d.scanCluster(d.sql.QueryRow(clusterSelect + ` ORDER BY id LIMIT 1`))
	}
	return c, err
}

// ListClusters returns all clusters ordered by id.
func (d *DB) ListClusters() ([]Cluster, error) {
	rows, err := d.sql.Query(clusterSelect + ` ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Cluster
	for rows.Next() {
		c, err := scanClusterRows(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *c)
	}
	return out, rows.Err()
}

// UpdateCluster updates all mutable fields.
func (d *DB) UpdateCluster(c *Cluster) error {
	if c.IsDefault {
		if _, err := d.sql.Exec(`UPDATE clusters SET is_default=0 WHERE id<>?`, c.ID); err != nil {
			return err
		}
	}
	_, err := d.sql.Exec(
		`UPDATE clusters SET name=?, admin_endpoint=?, admin_token_enc=?, s3_endpoint=?,
		 s3_region=?, s3_access_key=?, s3_secret_key_enc=?, is_default=?, updated_at=? WHERE id=?`,
		c.Name, c.AdminEndpoint, c.AdminTokenEnc, c.S3Endpoint, c.S3Region,
		c.S3AccessKey, c.S3SecretKeyEnc, boolToInt(c.IsDefault), nowRFC3339(), c.ID,
	)
	return err
}

// DeleteCluster removes a cluster.
func (d *DB) DeleteCluster(id int64) error {
	_, err := d.sql.Exec(`DELETE FROM clusters WHERE id=?`, id)
	return err
}

const clusterSelect = `SELECT id, name, admin_endpoint, admin_token_enc, s3_endpoint,
	s3_region, s3_access_key, s3_secret_key_enc, is_default, created_at, updated_at FROM clusters`

func (d *DB) scanCluster(row *sql.Row) (*Cluster, error) {
	var c Cluster
	var def int
	err := row.Scan(&c.ID, &c.Name, &c.AdminEndpoint, &c.AdminTokenEnc, &c.S3Endpoint,
		&c.S3Region, &c.S3AccessKey, &c.S3SecretKeyEnc, &def, &c.CreatedAt, &c.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	c.IsDefault = def == 1
	return &c, nil
}

func scanClusterRows(rows *sql.Rows) (*Cluster, error) {
	var c Cluster
	var def int
	err := rows.Scan(&c.ID, &c.Name, &c.AdminEndpoint, &c.AdminTokenEnc, &c.S3Endpoint,
		&c.S3Region, &c.S3AccessKey, &c.S3SecretKeyEnc, &def, &c.CreatedAt, &c.UpdatedAt)
	if err != nil {
		return nil, err
	}
	c.IsDefault = def == 1
	return &c, nil
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/db/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/db/clusters.go internal/db/clusters_test.go
git commit -m "feat: add clusters repository"
```

---

## Task 6: Sessions repository

**Files:**
- Create: `internal/db/sessions.go`
- Test: `internal/db/sessions_test.go`

- [ ] **Step 1: Write the failing test**

Create `internal/db/sessions_test.go`:
```go
package db

import (
	"testing"
	"time"
)

func TestCreateGetDeleteSession(t *testing.T) {
	d := newTestDB(t)
	u, _ := d.CreateUser("alice", "h", "admin")
	exp := time.Now().Add(time.Hour).UTC().Format(time.RFC3339)

	if err := d.CreateSession("tok-123", u.ID, exp); err != nil {
		t.Fatal(err)
	}
	got, err := d.GetSession("tok-123")
	if err != nil {
		t.Fatal(err)
	}
	if got.UserID != u.ID {
		t.Errorf("UserID = %d, want %d", got.UserID, u.ID)
	}
	if err := d.DeleteSession("tok-123"); err != nil {
		t.Fatal(err)
	}
	if _, err := d.GetSession("tok-123"); err == nil {
		t.Error("expected session gone")
	}
}

func TestDeleteExpiredSessions(t *testing.T) {
	d := newTestDB(t)
	u, _ := d.CreateUser("a", "h", "admin")
	past := time.Now().Add(-time.Hour).UTC().Format(time.RFC3339)
	future := time.Now().Add(time.Hour).UTC().Format(time.RFC3339)
	d.CreateSession("old", u.ID, past)
	d.CreateSession("new", u.ID, future)

	if err := d.DeleteExpiredSessions(); err != nil {
		t.Fatal(err)
	}
	if _, err := d.GetSession("old"); err == nil {
		t.Error("expected expired session removed")
	}
	if _, err := d.GetSession("new"); err != nil {
		t.Error("expected valid session kept")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/db/ -run Session`
Expected: FAIL (build error).

- [ ] **Step 3: Write minimal implementation**

Create `internal/db/sessions.go`:
```go
package db

import (
	"database/sql"
	"errors"
)

// Session is a stored login session.
type Session struct {
	Token     string
	UserID    int64
	CreatedAt string
	ExpiresAt string
}

// CreateSession inserts a session row.
func (d *DB) CreateSession(token string, userID int64, expiresAt string) error {
	_, err := d.sql.Exec(
		`INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)`,
		token, userID, nowRFC3339(), expiresAt,
	)
	return err
}

// GetSession fetches a session by token.
func (d *DB) GetSession(token string) (*Session, error) {
	var s Session
	err := d.sql.QueryRow(
		`SELECT token, user_id, created_at, expires_at FROM sessions WHERE token=?`, token,
	).Scan(&s.Token, &s.UserID, &s.CreatedAt, &s.ExpiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &s, nil
}

// DeleteSession removes a session by token.
func (d *DB) DeleteSession(token string) error {
	_, err := d.sql.Exec(`DELETE FROM sessions WHERE token=?`, token)
	return err
}

// DeleteExpiredSessions removes sessions whose expires_at is in the past.
func (d *DB) DeleteExpiredSessions() error {
	_, err := d.sql.Exec(`DELETE FROM sessions WHERE expires_at < ?`, nowRFC3339())
	return err
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/db/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/db/sessions.go internal/db/sessions_test.go
git commit -m "feat: add sessions repository"
```

---

## Task 7: Password hashing

**Files:**
- Create: `internal/auth/password.go`
- Test: `internal/auth/password_test.go`

- [ ] **Step 1: Write the failing test**

Create `internal/auth/password_test.go`:
```go
package auth

import "testing"

func TestHashAndVerify(t *testing.T) {
	hash, err := HashPassword("hunter2")
	if err != nil {
		t.Fatal(err)
	}
	if hash == "hunter2" {
		t.Fatal("hash equals plaintext")
	}
	if !VerifyPassword(hash, "hunter2") {
		t.Error("correct password should verify")
	}
	if VerifyPassword(hash, "wrong") {
		t.Error("wrong password should not verify")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/auth/`
Expected: FAIL (build error — `HashPassword` undefined).

- [ ] **Step 3: Write minimal implementation**

Create `internal/auth/password.go`:
```go
// Package auth handles password hashing, sessions, and request authentication.
package auth

import "golang.org/x/crypto/bcrypt"

// HashPassword returns a bcrypt hash of the password.
func HashPassword(plain string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(plain), bcrypt.DefaultCost)
	return string(b), err
}

// VerifyPassword reports whether plain matches the bcrypt hash.
func VerifyPassword(hash, plain string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(plain)) == nil
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/auth/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/auth/password.go internal/auth/password_test.go
git commit -m "feat: add password hashing"
```

---

## Task 8: Session service + middleware

**Files:**
- Create: `internal/auth/session.go`
- Test: `internal/auth/session_test.go`

- [ ] **Step 1: Write the failing test**

Create `internal/auth/session_test.go`:
```go
package auth

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/HungHD/garage-admin/internal/db"
)

func newDB(t *testing.T) *db.DB {
	t.Helper()
	d, err := db.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	return d
}

func TestLoginCreatesSessionAndCookie(t *testing.T) {
	d := newDB(t)
	hash, _ := HashPassword("pw")
	user, _ := d.CreateUser("alice", hash, "admin")

	svc := NewService(d)
	rec := httptest.NewRecorder()
	got, err := svc.Login(rec, "alice", "pw")
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != user.ID {
		t.Fatalf("got user %d, want %d", got.ID, user.ID)
	}
	if len(rec.Result().Cookies()) == 0 {
		t.Fatal("expected a session cookie to be set")
	}
}

func TestLoginWrongPassword(t *testing.T) {
	d := newDB(t)
	hash, _ := HashPassword("pw")
	d.CreateUser("alice", hash, "admin")
	svc := NewService(d)
	if _, err := svc.Login(httptest.NewRecorder(), "alice", "bad"); err == nil {
		t.Error("expected error on wrong password")
	}
}

func TestMiddlewareRejectsUnauthenticated(t *testing.T) {
	d := newDB(t)
	svc := NewService(d)
	handler := svc.RequireAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest("GET", "/", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("code = %d, want 401", rec.Code)
	}
}

func TestMiddlewareAllowsAuthenticated(t *testing.T) {
	d := newDB(t)
	hash, _ := HashPassword("pw")
	d.CreateUser("alice", hash, "admin")
	svc := NewService(d)

	loginRec := httptest.NewRecorder()
	svc.Login(loginRec, "alice", "pw")
	cookie := loginRec.Result().Cookies()[0]

	handler := svc.RequireAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u := UserFromContext(r.Context())
		if u == nil || u.Username != "alice" {
			t.Error("expected user in context")
		}
		w.WriteHeader(http.StatusOK)
	}))
	req := httptest.NewRequest("GET", "/", nil)
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("code = %d, want 200", rec.Code)
	}
}

func TestRequireAdminRejectsReadonly(t *testing.T) {
	d := newDB(t)
	hash, _ := HashPassword("pw")
	d.CreateUser("bob", hash, "readonly")
	svc := NewService(d)
	loginRec := httptest.NewRecorder()
	svc.Login(loginRec, "bob", "pw")
	cookie := loginRec.Result().Cookies()[0]

	handler := svc.RequireAuth(svc.RequireAdmin(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})))
	req := httptest.NewRequest("POST", "/", nil)
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Errorf("code = %d, want 403", rec.Code)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/auth/ -run Session`
Expected: FAIL (build error — `NewService` undefined).

- [ ] **Step 3: Write minimal implementation**

Create `internal/auth/session.go`:
```go
package auth

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/http"
	"time"

	"github.com/HungHD/garage-admin/internal/db"
)

const (
	cookieName     = "ga_session"
	sessionTTL     = 24 * time.Hour
)

// ErrInvalidCredentials is returned when login fails.
var ErrInvalidCredentials = errors.New("invalid credentials")

type ctxKey int

const userKey ctxKey = 0

// Service handles login, logout, and request authentication.
type Service struct {
	db     *db.DB
	secure bool // set Secure flag on cookies (true when serving HTTPS)
}

// NewService creates a session service.
func NewService(d *db.DB) *Service { return &Service{db: d} }

// SetSecure toggles the Secure cookie flag.
func (s *Service) SetSecure(v bool) { s.secure = v }

// Login verifies credentials, creates a session, and sets the cookie.
func (s *Service) Login(w http.ResponseWriter, username, password string) (*db.User, error) {
	u, err := s.db.GetUserByUsername(username)
	if errors.Is(err, db.ErrNotFound) {
		return nil, ErrInvalidCredentials
	}
	if err != nil {
		return nil, err
	}
	if !VerifyPassword(u.PasswordHash, password) {
		return nil, ErrInvalidCredentials
	}
	token, err := randomToken()
	if err != nil {
		return nil, err
	}
	exp := time.Now().Add(sessionTTL).UTC()
	if err := s.db.CreateSession(token, u.ID, exp.Format(time.RFC3339)); err != nil {
		return nil, err
	}
	http.SetCookie(w, &http.Cookie{
		Name:     cookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   s.secure,
		SameSite: http.SameSiteLaxMode,
		Expires:  exp,
	})
	return u, nil
}

// Logout deletes the current session and clears the cookie.
func (s *Service) Logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(cookieName); err == nil {
		s.db.DeleteSession(c.Value)
	}
	http.SetCookie(w, &http.Cookie{
		Name: cookieName, Value: "", Path: "/", HttpOnly: true,
		Secure: s.secure, SameSite: http.SameSiteLaxMode, MaxAge: -1,
	})
}

// RequireAuth is middleware that loads the user from the session cookie.
func (s *Service) RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(cookieName)
		if err != nil {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		sess, err := s.db.GetSession(c.Value)
		if err != nil {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if exp, perr := time.Parse(time.RFC3339, sess.ExpiresAt); perr == nil && time.Now().After(exp) {
			s.db.DeleteSession(c.Value)
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		u, err := s.db.GetUserByID(sess.UserID)
		if err != nil {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		ctx := context.WithValue(r.Context(), userKey, u)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// RequireAdmin is middleware (use after RequireAuth) that rejects non-admins.
func (s *Service) RequireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u := UserFromContext(r.Context())
		if u == nil || u.Role != "admin" {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// UserFromContext returns the authenticated user, or nil.
func UserFromContext(ctx context.Context) *db.User {
	u, _ := ctx.Value(userKey).(*db.User)
	return u
}

func randomToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/auth/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/auth/session.go internal/auth/session_test.go
git commit -m "feat: add session service and auth middleware"
```

---

## Task 9: Garage Admin API v2 client

**Files:**
- Create: `internal/garage/client.go`
- Test: `internal/garage/client_test.go`

- [ ] **Step 1: Write the failing test**

Create `internal/garage/client_test.go`:
```go
package garage

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGetClusterHealth(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v2/GetClusterHealth" {
			t.Errorf("path = %q", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer secret-token" {
			t.Errorf("missing bearer token, got %q", r.Header.Get("Authorization"))
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"healthy","knownNodes":3,"connectedNodes":3,"storageNodes":3,"storageNodesOk":3,"partitions":256,"partitionsQuorum":256,"partitionsAllOk":256}`))
	}))
	defer srv.Close()

	c := New(srv.URL, "secret-token")
	h, err := c.GetClusterHealth()
	if err != nil {
		t.Fatal(err)
	}
	if h.Status != "healthy" || h.ConnectedNodes != 3 {
		t.Errorf("unexpected health: %+v", h)
	}
}

func TestErrorStatusReturnsError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(`{"code":"unauthorized","message":"bad token"}`))
	}))
	defer srv.Close()

	c := New(srv.URL, "x")
	if _, err := c.GetClusterHealth(); err == nil {
		t.Error("expected error on 401")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/garage/`
Expected: FAIL (build error — `New` undefined).

- [ ] **Step 3: Write minimal implementation**

Create `internal/garage/client.go`:
```go
// Package garage is a typed client for the Garage Admin API v2.
package garage

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Client talks to a single Garage cluster's Admin API.
type Client struct {
	endpoint string
	token    string
	http     *http.Client
}

// New creates a client. endpoint is like "http://192.168.101.8:3903".
func New(endpoint, token string) *Client {
	return &Client{
		endpoint: strings.TrimRight(endpoint, "/"),
		token:    token,
		http:     &http.Client{Timeout: 15 * time.Second},
	}
}

// ClusterHealth mirrors GetClusterHealth response.
type ClusterHealth struct {
	Status           string `json:"status"`
	KnownNodes       int    `json:"knownNodes"`
	ConnectedNodes   int    `json:"connectedNodes"`
	StorageNodes     int    `json:"storageNodes"`
	StorageNodesOk   int    `json:"storageNodesOk"`
	Partitions       int    `json:"partitions"`
	PartitionsQuorum int    `json:"partitionsQuorum"`
	PartitionsAllOk  int    `json:"partitionsAllOk"`
}

// GetClusterHealth calls GET /v2/GetClusterHealth.
func (c *Client) GetClusterHealth() (*ClusterHealth, error) {
	var out ClusterHealth
	if err := c.do(context.Background(), http.MethodGet, "/v2/GetClusterHealth", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// GetClusterStatus returns the raw cluster status JSON (typed later as needed).
func (c *Client) GetClusterStatus() (map[string]any, error) {
	var out map[string]any
	if err := c.do(context.Background(), http.MethodGet, "/v2/GetClusterStatus", nil, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// do performs an Admin API request and decodes the JSON response into out.
func (c *Client) do(ctx context.Context, method, path string, body, out any) error {
	var reader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = strings.NewReader(string(b))
	}
	req, err := http.NewRequestWithContext(ctx, method, c.endpoint+path, reader)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("garage: %s %s -> %d: %s", method, path, resp.StatusCode, string(data))
	}
	if out != nil && len(data) > 0 {
		if err := json.Unmarshal(data, out); err != nil {
			return fmt.Errorf("garage: decode %s: %w", path, err)
		}
	}
	return nil
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/garage/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/garage/
git commit -m "feat: add Garage Admin API v2 client"
```

---

## Task 10: API server skeleton + helpers

**Files:**
- Create: `internal/api/server.go`
- Test: `internal/api/server_test.go`

- [ ] **Step 1: Write the failing test**

Create `internal/api/server_test.go`:
```go
package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHealthEndpoint(t *testing.T) {
	srv := &Server{}
	r := srv.Routes()
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest("GET", "/api/health", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d, want 200", rec.Code)
	}
	var body map[string]string
	json.Unmarshal(rec.Body.Bytes(), &body)
	if body["status"] != "ok" {
		t.Errorf("status = %q, want ok", body["status"])
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/api/`
Expected: FAIL (build error — `Server` undefined).

- [ ] **Step 3: Write minimal implementation**

Create `internal/api/server.go`:
```go
// Package api wires HTTP routes for the admin website.
package api

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/HungHD/garage-admin/internal/auth"
	"github.com/HungHD/garage-admin/internal/crypto"
	"github.com/HungHD/garage-admin/internal/db"
)

// Server holds dependencies shared by handlers.
type Server struct {
	DB     *db.DB
	Auth   *auth.Service
	Cipher *crypto.Cipher
	Static http.Handler // SPA fallback handler (set in Task 14)
}

// Routes builds the chi router.
func (s *Server) Routes() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.Recoverer)

	r.Route("/api", func(r chi.Router) {
		r.Get("/health", func(w http.ResponseWriter, _ *http.Request) {
			writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
		})
		s.mountAuth(r)     // Task 11
		s.mountClusters(r) // Task 12
		s.mountCluster(r)  // Task 13 (status proxy)
	})

	if s.Static != nil {
		r.NotFound(s.Static.ServeHTTP)
	}
	return r
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func decodeJSON(r *http.Request, v any) error {
	return json.NewDecoder(r.Body).Decode(v)
}
```

Note: `mountAuth`, `mountClusters`, `mountCluster` are defined in later tasks. To keep this
task compiling on its own, add temporary stubs now in `server.go`:
```go
func (s *Server) mountAuth(r chi.Router)     {}
func (s *Server) mountClusters(r chi.Router) {}
func (s *Server) mountCluster(r chi.Router)  {}
```
These stubs are **replaced** (moved to their own files) in Tasks 11–13. Delete the stub
when you add the real method.

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/api/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/api/server.go internal/api/server_test.go
git commit -m "feat: add API server skeleton with health endpoint"
```

---

## Task 11: Auth handlers (/api/auth/*)

**Files:**
- Create: `internal/api/auth.go`
- Modify: `internal/api/server.go` (remove `mountAuth` stub)
- Test: `internal/api/auth_test.go`

- [ ] **Step 1: Write the failing test**

Create `internal/api/auth_test.go`:
```go
package api

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/HungHD/garage-admin/internal/auth"
	"github.com/HungHD/garage-admin/internal/db"
)

func newAPITest(t *testing.T) *Server {
	t.Helper()
	d, err := db.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	hash, _ := auth.HashPassword("pw")
	d.CreateUser("alice", hash, "admin")
	return &Server{DB: d, Auth: auth.NewService(d)}
}

func TestLoginLogoutMe(t *testing.T) {
	srv := newAPITest(t)
	r := srv.Routes()

	// login
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/auth/login", strings.NewReader(`{"username":"alice","password":"pw"}`))
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("login code = %d, body=%s", rec.Code, rec.Body.String())
	}
	cookies := rec.Result().Cookies()
	if len(cookies) == 0 {
		t.Fatal("expected session cookie")
	}

	// me
	meRec := httptest.NewRecorder()
	meReq := httptest.NewRequest("GET", "/api/auth/me", nil)
	meReq.AddCookie(cookies[0])
	r.ServeHTTP(meRec, meReq)
	if meRec.Code != http.StatusOK || !strings.Contains(meRec.Body.String(), "alice") {
		t.Fatalf("me code=%d body=%s", meRec.Code, meRec.Body.String())
	}
}

func TestLoginBadCredentials(t *testing.T) {
	srv := newAPITest(t)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/auth/login", strings.NewReader(`{"username":"alice","password":"nope"}`))
	srv.Routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("code = %d, want 401", rec.Code)
	}
}

func TestMeWithoutSession(t *testing.T) {
	srv := newAPITest(t)
	rec := httptest.NewRecorder()
	srv.Routes().ServeHTTP(rec, httptest.NewRequest("GET", "/api/auth/me", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("code = %d, want 401", rec.Code)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/api/ -run Login`
Expected: FAIL (login returns 404/empty because stub mounts nothing).

- [ ] **Step 3: Write minimal implementation**

In `internal/api/server.go`, **delete** the `func (s *Server) mountAuth(r chi.Router) {}` stub.

Create `internal/api/auth.go`:
```go
package api

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/HungHD/garage-admin/internal/auth"
	"github.com/HungHD/garage-admin/internal/db"
)

func (s *Server) mountAuth(r chi.Router) {
	r.Post("/auth/login", s.handleLogin)
	r.Post("/auth/logout", s.handleLogout)
	r.With(s.Auth.RequireAuth).Get("/auth/me", s.handleMe)
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	user, err := s.Auth.Login(w, body.Username, body.Password)
	if errors.Is(err, auth.ErrInvalidCredentials) {
		writeError(w, http.StatusUnauthorized, "invalid credentials")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "login failed")
		return
	}
	writeJSON(w, http.StatusOK, userView(user))
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	s.Auth.Logout(w, r)
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromContext(r.Context())
	writeJSON(w, http.StatusOK, userView(u))
}

func userView(u *db.User) map[string]any {
	return map[string]any{"id": u.ID, "username": u.Username, "role": u.Role}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/api/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/api/auth.go internal/api/server.go internal/api/auth_test.go
git commit -m "feat: add auth handlers (login/logout/me)"
```

---

## Task 12: Cluster connection CRUD handlers (/api/clusters)

**Files:**
- Create: `internal/api/clusters.go`
- Modify: `internal/api/server.go` (remove `mountClusters` stub)
- Test: `internal/api/clusters_test.go`

Handlers encrypt `admin_token` and `s3_secret_key` via `s.Cipher` before storing, and never
return secrets in responses. Mutating routes require admin role.

- [ ] **Step 1: Write the failing test**

Create `internal/api/clusters_test.go`:
```go
package api

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/HungHD/garage-admin/internal/auth"
	"github.com/HungHD/garage-admin/internal/crypto"
	"github.com/HungHD/garage-admin/internal/db"
)

func newClusterAPITest(t *testing.T, role string) (*Server, *http.Cookie) {
	t.Helper()
	d, err := db.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	hash, _ := auth.HashPassword("pw")
	d.CreateUser("u", hash, role)
	cph, _ := crypto.New([]byte("0123456789abcdef0123456789abcdef"))
	srv := &Server{DB: d, Auth: auth.NewService(d), Cipher: cph}

	rec := httptest.NewRecorder()
	srv.Routes().ServeHTTP(rec, httptest.NewRequest("POST", "/api/auth/login", strings.NewReader(`{"username":"u","password":"pw"}`)))
	return srv, rec.Result().Cookies()[0]
}

func TestCreateListClusterHidesSecret(t *testing.T) {
	srv, cookie := newClusterAPITest(t, "admin")
	r := srv.Routes()

	body := `{"name":"local","admin_endpoint":"http://192.168.101.8:3903","admin_token":"tok","s3_endpoint":"http://192.168.101.8:3900","s3_region":"garage","s3_access_key":"GK","s3_secret_key":"sek","is_default":true}`
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/clusters", strings.NewReader(body))
	req.AddCookie(cookie)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create code=%d body=%s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "tok") || strings.Contains(rec.Body.String(), "sek") {
		t.Error("response leaked a secret")
	}

	listRec := httptest.NewRecorder()
	listReq := httptest.NewRequest("GET", "/api/clusters", nil)
	listReq.AddCookie(cookie)
	r.ServeHTTP(listRec, listReq)
	if !strings.Contains(listRec.Body.String(), "local") {
		t.Errorf("list missing cluster: %s", listRec.Body.String())
	}
	if strings.Contains(listRec.Body.String(), "tok") {
		t.Error("list leaked token")
	}
}

func TestReadonlyCannotCreateCluster(t *testing.T) {
	srv, cookie := newClusterAPITest(t, "readonly")
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/clusters", strings.NewReader(`{"name":"x","admin_endpoint":"http://y","admin_token":"t"}`))
	req.AddCookie(cookie)
	srv.Routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Errorf("code = %d, want 403", rec.Code)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/api/ -run Cluster`
Expected: FAIL (routes not mounted).

- [ ] **Step 3: Write minimal implementation**

In `internal/api/server.go`, **delete** the `func (s *Server) mountClusters(r chi.Router) {}` stub.

Create `internal/api/clusters.go`:
```go
package api

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/HungHD/garage-admin/internal/db"
)

type clusterInput struct {
	Name          string `json:"name"`
	AdminEndpoint string `json:"admin_endpoint"`
	AdminToken    string `json:"admin_token"`
	S3Endpoint    string `json:"s3_endpoint"`
	S3Region      string `json:"s3_region"`
	S3AccessKey   string `json:"s3_access_key"`
	S3SecretKey   string `json:"s3_secret_key"`
	IsDefault     bool   `json:"is_default"`
}

// clusterView is the safe representation returned to clients (no secrets).
func clusterView(c *db.Cluster) map[string]any {
	return map[string]any{
		"id": c.ID, "name": c.Name, "admin_endpoint": c.AdminEndpoint,
		"s3_endpoint": c.S3Endpoint, "s3_region": c.S3Region,
		"s3_access_key": c.S3AccessKey, "is_default": c.IsDefault,
		"has_admin_token": c.AdminTokenEnc != "", "has_s3_secret": c.S3SecretKeyEnc != "",
	}
}

func (s *Server) mountClusters(r chi.Router) {
	r.Route("/clusters", func(r chi.Router) {
		r.Use(s.Auth.RequireAuth)
		r.Get("/", s.handleListClusters)
		r.With(s.Auth.RequireAdmin).Post("/", s.handleCreateCluster)
		r.With(s.Auth.RequireAdmin).Put("/{id}", s.handleUpdateCluster)
		r.With(s.Auth.RequireAdmin).Delete("/{id}", s.handleDeleteCluster)
	})
}

func (s *Server) handleListClusters(w http.ResponseWriter, r *http.Request) {
	list, err := s.DB.ListClusters()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "list failed")
		return
	}
	out := make([]map[string]any, 0, len(list))
	for i := range list {
		out = append(out, clusterView(&list[i]))
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleCreateCluster(w http.ResponseWriter, r *http.Request) {
	var in clusterInput
	if err := decodeJSON(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	c, err := s.clusterFromInput(&in, "")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "encrypt failed")
		return
	}
	created, err := s.DB.CreateCluster(c)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "create failed")
		return
	}
	writeJSON(w, http.StatusCreated, clusterView(created))
}

func (s *Server) handleUpdateCluster(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad id")
		return
	}
	existing, err := s.DB.GetCluster(id)
	if err != nil {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	var in clusterInput
	if err := decodeJSON(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	// Preserve existing encrypted secrets when the input leaves them blank.
	c, err := s.clusterFromInputPreserving(&in, existing)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "encrypt failed")
		return
	}
	c.ID = id
	if err := s.DB.UpdateCluster(c); err != nil {
		writeError(w, http.StatusInternalServerError, "update failed")
		return
	}
	writeJSON(w, http.StatusOK, clusterView(c))
}

func (s *Server) handleDeleteCluster(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad id")
		return
	}
	if err := s.DB.DeleteCluster(id); err != nil {
		writeError(w, http.StatusInternalServerError, "delete failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) clusterFromInput(in *clusterInput, _ string) (*db.Cluster, error) {
	tokenEnc, err := s.Cipher.Encrypt(in.AdminToken)
	if err != nil {
		return nil, err
	}
	var secEnc string
	if in.S3SecretKey != "" {
		secEnc, err = s.Cipher.Encrypt(in.S3SecretKey)
		if err != nil {
			return nil, err
		}
	}
	region := in.S3Region
	if region == "" {
		region = "garage"
	}
	return &db.Cluster{
		Name: in.Name, AdminEndpoint: in.AdminEndpoint, AdminTokenEnc: tokenEnc,
		S3Endpoint: in.S3Endpoint, S3Region: region, S3AccessKey: in.S3AccessKey,
		S3SecretKeyEnc: secEnc, IsDefault: in.IsDefault,
	}, nil
}

func (s *Server) clusterFromInputPreserving(in *clusterInput, existing *db.Cluster) (*db.Cluster, error) {
	c, err := s.clusterFromInput(in, "")
	if err != nil {
		return nil, err
	}
	if in.AdminToken == "" {
		c.AdminTokenEnc = existing.AdminTokenEnc
	}
	if in.S3SecretKey == "" {
		c.S3SecretKeyEnc = existing.S3SecretKeyEnc
	}
	return c, nil
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/api/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/api/clusters.go internal/api/server.go internal/api/clusters_test.go
git commit -m "feat: add cluster connection CRUD handlers"
```

---

## Task 13: Cluster status proxy + helper to build a Garage client

**Files:**
- Create: `internal/api/cluster_status.go`
- Modify: `internal/api/server.go` (remove `mountCluster` stub)
- Test: `internal/api/cluster_status_test.go`

- [ ] **Step 1: Write the failing test**

Create `internal/api/cluster_status_test.go`:
```go
package api

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/HungHD/garage-admin/internal/auth"
	"github.com/HungHD/garage-admin/internal/crypto"
	"github.com/HungHD/garage-admin/internal/db"
)

func TestClusterHealthProxy(t *testing.T) {
	// Fake Garage server.
	garageSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"status":"healthy","connectedNodes":2}`))
	}))
	defer garageSrv.Close()

	d, _ := db.Open(filepath.Join(t.TempDir(), "t.db"))
	t.Cleanup(func() { d.Close() })
	hash, _ := auth.HashPassword("pw")
	d.CreateUser("u", hash, "admin")
	cph, _ := crypto.New([]byte("0123456789abcdef0123456789abcdef"))
	enc, _ := cph.Encrypt("tok")
	d.CreateCluster(&db.Cluster{Name: "c", AdminEndpoint: garageSrv.URL, AdminTokenEnc: enc, IsDefault: true})

	srv := &Server{DB: d, Auth: auth.NewService(d), Cipher: cph}
	r := srv.Routes()

	loginRec := httptest.NewRecorder()
	r.ServeHTTP(loginRec, httptest.NewRequest("POST", "/api/auth/login", strings.NewReader(`{"username":"u","password":"pw"}`)))
	cookie := loginRec.Result().Cookies()[0]

	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/api/cluster/health", nil)
	req.AddCookie(cookie)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("code=%d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "healthy") {
		t.Errorf("body = %s", rec.Body.String())
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/api/ -run ClusterHealthProxy`
Expected: FAIL (route not mounted).

- [ ] **Step 3: Write minimal implementation**

In `internal/api/server.go`, **delete** the `func (s *Server) mountCluster(r chi.Router) {}` stub.

Create `internal/api/cluster_status.go`:
```go
package api

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/HungHD/garage-admin/internal/db"
	"github.com/HungHD/garage-admin/internal/garage"
)

func (s *Server) mountCluster(r chi.Router) {
	r.Route("/cluster", func(r chi.Router) {
		r.Use(s.Auth.RequireAuth)
		r.Get("/health", s.handleClusterHealth)
		r.Get("/status", s.handleClusterStatus)
	})
}

// garageClientForRequest builds a Garage client for the selected cluster.
// Cluster is chosen by ?cluster=<id>, falling back to the default cluster.
func (s *Server) garageClientForRequest(r *http.Request) (*garage.Client, error) {
	var c *db.Cluster
	var err error
	if idStr := r.URL.Query().Get("cluster"); idStr != "" {
		id, perr := strconv.ParseInt(idStr, 10, 64)
		if perr != nil {
			return nil, perr
		}
		c, err = s.DB.GetCluster(id)
	} else {
		c, err = s.DB.GetDefaultCluster()
	}
	if err != nil {
		return nil, err
	}
	token, err := s.Cipher.Decrypt(c.AdminTokenEnc)
	if err != nil {
		return nil, err
	}
	return garage.New(c.AdminEndpoint, token), nil
}

func (s *Server) handleClusterHealth(w http.ResponseWriter, r *http.Request) {
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	h, err := client.GetClusterHealth()
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, h)
}

func (s *Server) handleClusterStatus(w http.ResponseWriter, r *http.Request) {
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	st, err := client.GetClusterStatus()
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, st)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/api/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/api/cluster_status.go internal/api/server.go internal/api/cluster_status_test.go
git commit -m "feat: add cluster health/status proxy endpoints"
```

---

## Task 14: Embed frontend + SPA fallback

**Files:**
- Create: `internal/web/embed.go`, `web/dist/index.html` (placeholder until frontend builds)
- Test: `internal/web/embed_test.go`

The embed directive needs `web/dist` to exist at build time. We create a placeholder now;
the real build (Task 15+) overwrites it. The SPA fallback serves `index.html` for any path
that doesn't match a static file, so client-side routing works.

- [ ] **Step 1: Create placeholder dist**

Create `web/dist/index.html`:
```html
<!doctype html><html><head><meta charset="utf-8"><title>Garage Admin</title></head>
<body><div id="root">loading…</div></body></html>
```

- [ ] **Step 2: Write the failing test**

Create `internal/web/embed_test.go`:
```go
package web

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestServesIndexForUnknownPath(t *testing.T) {
	h := Handler()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/some/spa/route", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d, want 200", rec.Code)
	}
	if rec.Header().Get("Content-Type") == "" {
		t.Error("expected a content-type")
	}
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `go test ./internal/web/`
Expected: FAIL (build error — `Handler` undefined).

- [ ] **Step 4: Write minimal implementation**

Create `internal/web/embed.go`:
```go
// Package web embeds the built frontend and serves it with SPA fallback.
package web

import (
	"embed"
	"io/fs"
	"net/http"
	"path"
	"strings"
)

//go:embed all:dist
var distFS embed.FS

// Handler serves embedded static files; unknown paths fall back to index.html.
func Handler() http.Handler {
	sub, err := fs.Sub(distFS, "dist")
	if err != nil {
		panic(err)
	}
	fileServer := http.FileServer(http.FS(sub))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		clean := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if clean == "" {
			clean = "index.html"
		}
		if _, err := fs.Stat(sub, clean); err != nil {
			// Not a real file → serve index.html for client-side routing.
			r2 := r.Clone(r.Context())
			r2.URL.Path = "/"
			indexBytes, _ := fs.ReadFile(sub, "index.html")
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Write(indexBytes)
			return
		}
		fileServer.ServeHTTP(w, r)
	})
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `go test ./internal/web/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add internal/web/ web/dist/index.html
git commit -m "feat: embed frontend with SPA fallback"
```

---

## Task 15: main.go wiring + first end-to-end run

**Files:**
- Create: `cmd/garage-admin/main.go`

- [ ] **Step 1: Write main.go**

Create `cmd/garage-admin/main.go`:
```go
// Command garage-admin runs the Garage admin website server.
package main

import (
	"log"
	"net/http"

	"github.com/HungHD/garage-admin/internal/api"
	"github.com/HungHD/garage-admin/internal/auth"
	"github.com/HungHD/garage-admin/internal/config"
	"github.com/HungHD/garage-admin/internal/crypto"
	"github.com/HungHD/garage-admin/internal/db"
	"github.com/HungHD/garage-admin/internal/web"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	database, err := db.Open(cfg.DBPath)
	if err != nil {
		log.Fatalf("db: %v", err)
	}
	defer database.Close()

	if err := bootstrapAdmin(database, cfg); err != nil {
		log.Fatalf("bootstrap: %v", err)
	}

	cipher, err := crypto.New(cfg.SecretKey)
	if err != nil {
		log.Fatalf("crypto: %v", err)
	}

	srv := &api.Server{
		DB:     database,
		Auth:   auth.NewService(database),
		Cipher: cipher,
		Static: web.Handler(),
	}

	log.Printf("garage-admin listening on :%s", cfg.Port)
	if err := http.ListenAndServe(":"+cfg.Port, srv.Routes()); err != nil {
		log.Fatal(err)
	}
}

// bootstrapAdmin creates an initial admin user from env if no users exist.
func bootstrapAdmin(d *db.DB, cfg *config.Config) error {
	n, err := d.CountUsers()
	if err != nil {
		return err
	}
	if n > 0 || cfg.AdminUser == "" || cfg.AdminPass == "" {
		return nil
	}
	hash, err := auth.HashPassword(cfg.AdminPass)
	if err != nil {
		return err
	}
	_, err = d.CreateUser(cfg.AdminUser, hash, "admin")
	if err == nil {
		log.Printf("bootstrapped admin user %q", cfg.AdminUser)
	}
	return err
}
```

- [ ] **Step 2: Build the whole module**

Run: `go build ./...`
Expected: builds with no errors.

- [ ] **Step 3: Run all backend tests**

Run: `go test ./...`
Expected: all PASS.

- [ ] **Step 4: Manual smoke test against real Garage**

Run (replace token with your real Garage admin token):
```bash
APP_SECRET_KEY=0123456789abcdef0123456789abcdef \
APP_DB_PATH=./tmp/app.db \
APP_PORT=8080 \
ADMIN_USER=admin ADMIN_PASSWORD=admin123 \
go run ./cmd/garage-admin
```
Then in another terminal:
```bash
curl -s localhost:8080/api/health
# -> {"status":"ok"}
curl -s -c /tmp/cj -X POST localhost:8080/api/auth/login \
  -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin123"}'
# -> {"id":1,"role":"admin","username":"admin"}
curl -s -b /tmp/cj -X POST localhost:8080/api/clusters \
  -H 'Content-Type: application/json' \
  -d '{"name":"local","admin_endpoint":"http://192.168.101.8:3903","admin_token":"<REAL_TOKEN>","is_default":true}'
curl -s -b /tmp/cj localhost:8080/api/cluster/health
# -> JSON health from the real Garage cluster
```
Expected: the last call returns live cluster health. Stop the server (Ctrl-C) and `rm -rf ./tmp` after.

- [ ] **Step 5: Commit**

```bash
git add cmd/garage-admin/main.go
git commit -m "feat: wire main with bootstrap admin and end-to-end server"
```

---

## Task 16: Frontend scaffold (Vite + React + Mantine)

**Files:**
- Create: `web/package.json`, `web/vite.config.ts`, `web/tsconfig.json`, `web/tsconfig.node.json`, `web/index.html`, `web/src/main.tsx`, `web/src/App.tsx`

- [ ] **Step 1: Create `web/package.json`**

```json
{
  "name": "garage-admin-web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@mantine/core": "^7.13.0",
    "@mantine/hooks": "^7.13.0",
    "@mantine/notifications": "^7.13.0",
    "@tabler/icons-react": "^3.19.0",
    "@tanstack/react-query": "^5.59.0",
    "axios": "^1.7.7",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.2"
  },
  "devDependencies": {
    "@types/react": "^18.3.10",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.2",
    "typescript": "^5.6.2",
    "vite": "^5.4.8"
  }
}
```

- [ ] **Step 2: Create `web/vite.config.ts`**

Dev proxy sends `/api` to the Go backend so cookies work on one origin.
```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8080' },
  },
})
```

- [ ] **Step 3: Create `web/tsconfig.json` and `web/tsconfig.node.json`**

`web/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```
`web/tsconfig.node.json`:
```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true,
    "strict": true
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 4: Create `web/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Garage Admin</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Create `web/src/main.tsx` and `web/src/App.tsx`**

`web/src/main.tsx`:
```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { MantineProvider } from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'
import { App } from './App'
import { themes, loadThemeName } from './theme/themes'
import { AuthProvider } from './auth/AuthContext'

const queryClient = new QueryClient()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MantineProvider theme={themes[loadThemeName()]} defaultColorScheme="auto">
      <Notifications />
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </MantineProvider>
  </React.StrictMode>,
)
```

`web/src/App.tsx`:
```tsx
import { Routes, Route, Navigate } from 'react-router-dom'
import { LoginPage } from './pages/LoginPage'
import { DashboardPage } from './pages/DashboardPage'
import { SettingsPage } from './pages/SettingsPage'
import { AppShell } from './components/AppShell'
import { useAuth } from './auth/AuthContext'

export function App() {
  const { user, loading } = useAuth()
  if (loading) return null
  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  )
}
```

- [ ] **Step 6: Install deps and verify type-check builds (after later files exist)**

Run:
```bash
cd web && npm install
```
Expected: installs without errors. (Full `npm run build` is verified in Task 20 once all
`src` files from Tasks 17–19 exist.)

- [ ] **Step 7: Commit**

```bash
git add web/package.json web/package-lock.json web/vite.config.ts web/tsconfig.json web/tsconfig.node.json web/index.html web/src/main.tsx web/src/App.tsx
git commit -m "feat: scaffold frontend (Vite + React + Mantine)"
```

---

## Task 17: Theme presets + API client + auth context

**Files:**
- Create: `web/src/theme/themes.ts`, `web/src/api/client.ts`, `web/src/auth/AuthContext.tsx`

- [ ] **Step 1: Create `web/src/theme/themes.ts`**

Five presets (Default, Ocean, Forest, Sunset, Mono). Selection persisted in localStorage.
```ts
import { createTheme, type MantineThemeOverride } from '@mantine/core'

export const themes: Record<string, MantineThemeOverride> = {
  Default: createTheme({ primaryColor: 'blue', defaultRadius: 'md' }),
  Ocean: createTheme({ primaryColor: 'cyan', defaultRadius: 'lg' }),
  Forest: createTheme({ primaryColor: 'teal', defaultRadius: 'md' }),
  Sunset: createTheme({ primaryColor: 'orange', defaultRadius: 'xl' }),
  Mono: createTheme({ primaryColor: 'gray', defaultRadius: 'xs' }),
}

export const themeNames = Object.keys(themes)
const STORAGE_KEY = 'ga_theme'

export function loadThemeName(): string {
  const saved = localStorage.getItem(STORAGE_KEY)
  return saved && themes[saved] ? saved : 'Default'
}

export function saveThemeName(name: string) {
  localStorage.setItem(STORAGE_KEY, name)
}
```

- [ ] **Step 2: Create `web/src/api/client.ts`**

```ts
import axios from 'axios'

export const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
})

export interface User {
  id: number
  username: string
  role: 'admin' | 'readonly'
}

export interface Cluster {
  id: number
  name: string
  admin_endpoint: string
  s3_endpoint: string
  s3_region: string
  s3_access_key: string
  is_default: boolean
  has_admin_token: boolean
  has_s3_secret: boolean
}

export interface ClusterHealth {
  status: string
  knownNodes: number
  connectedNodes: number
  storageNodes: number
  storageNodesOk: number
  partitions: number
  partitionsQuorum: number
  partitionsAllOk: number
}
```

- [ ] **Step 3: Create `web/src/auth/AuthContext.tsx`**

```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, type User } from '../api/client'

interface AuthState {
  user: User | null
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthState>(null as unknown as AuthState)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api
      .get<User>('/auth/me')
      .then((r) => setUser(r.data))
      .catch(() => setUser(null))
      .finally(() => setLoading(false))
  }, [])

  async function login(username: string, password: string) {
    const r = await api.post<User>('/auth/login', { username, password })
    setUser(r.data)
  }

  async function logout() {
    await api.post('/auth/logout')
    setUser(null)
  }

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
```

- [ ] **Step 4: Commit**

```bash
git add web/src/theme web/src/api web/src/auth
git commit -m "feat: add theme presets, API client, and auth context"
```

---

## Task 18: Login page + AppShell + theme switcher

**Files:**
- Create: `web/src/pages/LoginPage.tsx`, `web/src/components/AppShell.tsx`, `web/src/components/ThemeSwitcher.tsx`

- [ ] **Step 1: Create `web/src/pages/LoginPage.tsx`**

```tsx
import { useState } from 'react'
import { Button, Card, Center, PasswordInput, Stack, TextInput, Title } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useAuth } from '../auth/AuthContext'

export function LoginPage() {
  const { login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await login(username, password)
    } catch {
      notifications.show({ color: 'red', message: 'Sai tài khoản hoặc mật khẩu' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Center h="100vh">
      <Card withBorder shadow="md" p="xl" w={360}>
        <form onSubmit={submit}>
          <Stack>
            <Title order={3} ta="center">Garage Admin</Title>
            <TextInput label="Tài khoản" value={username} onChange={(e) => setUsername(e.currentTarget.value)} required />
            <PasswordInput label="Mật khẩu" value={password} onChange={(e) => setPassword(e.currentTarget.value)} required />
            <Button type="submit" loading={busy} fullWidth>Đăng nhập</Button>
          </Stack>
        </form>
      </Card>
    </Center>
  )
}
```

- [ ] **Step 2: Create `web/src/components/ThemeSwitcher.tsx`**

```tsx
import { Group, SegmentedControl, useMantineColorScheme, ActionIcon } from '@mantine/core'
import { IconSun, IconMoon } from '@tabler/icons-react'
import { themeNames, loadThemeName, saveThemeName } from '../theme/themes'

export function ThemeSwitcher() {
  const { colorScheme, toggleColorScheme } = useMantineColorScheme()

  function changeTheme(name: string) {
    saveThemeName(name)
    window.location.reload() // re-create MantineProvider with the new preset
  }

  return (
    <Group gap="xs">
      <SegmentedControl size="xs" data={themeNames} value={loadThemeName()} onChange={changeTheme} />
      <ActionIcon variant="default" onClick={toggleColorScheme} aria-label="toggle color scheme">
        {colorScheme === 'dark' ? <IconSun size={16} /> : <IconMoon size={16} />}
      </ActionIcon>
    </Group>
  )
}
```

- [ ] **Step 3: Create `web/src/components/AppShell.tsx`**

```tsx
import { AppShell as MantineAppShell, Burger, Group, NavLink, Title } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { IconDashboard, IconSettings, IconLogout } from '@tabler/icons-react'
import { Link, useLocation } from 'react-router-dom'
import { type ReactNode } from 'react'
import { useAuth } from '../auth/AuthContext'
import { ThemeSwitcher } from './ThemeSwitcher'

export function AppShell({ children }: { children: ReactNode }) {
  const [opened, { toggle }] = useDisclosure()
  const { user, logout } = useAuth()
  const loc = useLocation()

  return (
    <MantineAppShell
      header={{ height: 56 }}
      navbar={{ width: 240, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="md"
    >
      <MantineAppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group>
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <Title order={4}>Garage Admin</Title>
          </Group>
          <Group>
            <ThemeSwitcher />
            <NavLink label={`${user?.username} (${user?.role})`} leftSection={<IconLogout size={16} />} onClick={logout} w="auto" />
          </Group>
        </Group>
      </MantineAppShell.Header>
      <MantineAppShell.Navbar p="md">
        <NavLink component={Link} to="/" label="Dashboard" active={loc.pathname === '/'} leftSection={<IconDashboard size={18} />} />
        <NavLink component={Link} to="/settings" label="Settings" active={loc.pathname === '/settings'} leftSection={<IconSettings size={18} />} />
      </MantineAppShell.Navbar>
      <MantineAppShell.Main>{children}</MantineAppShell.Main>
    </MantineAppShell>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/LoginPage.tsx web/src/components/
git commit -m "feat: add login page, app shell, and theme switcher"
```

---

## Task 19: Dashboard + Settings (cluster connections) pages

**Files:**
- Create: `web/src/pages/DashboardPage.tsx`, `web/src/pages/SettingsPage.tsx`

- [ ] **Step 1: Create `web/src/pages/DashboardPage.tsx`**

```tsx
import { Card, Grid, Group, Loader, Text, Title, Badge, Stack } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { api, type ClusterHealth } from '../api/client'

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <Card withBorder>
      <Text size="sm" c="dimmed">{label}</Text>
      <Text fw={700} size="xl">{value}</Text>
    </Card>
  )
}

export function DashboardPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['cluster-health'],
    queryFn: async () => (await api.get<ClusterHealth>('/cluster/health')).data,
  })

  return (
    <Stack>
      <Title order={3}>Dashboard</Title>
      {isLoading && <Loader />}
      {error && <Text c="red">Chưa kết nối được cluster. Kiểm tra Settings.</Text>}
      {data && (
        <>
          <Group>
            <Text>Trạng thái:</Text>
            <Badge color={data.status === 'healthy' ? 'green' : 'red'}>{data.status}</Badge>
          </Group>
          <Grid>
            <Grid.Col span={{ base: 12, sm: 6, md: 3 }}><Stat label="Node kết nối" value={`${data.connectedNodes}/${data.knownNodes}`} /></Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6, md: 3 }}><Stat label="Storage nodes OK" value={`${data.storageNodesOk}/${data.storageNodes}`} /></Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6, md: 3 }}><Stat label="Partitions OK" value={`${data.partitionsAllOk}/${data.partitions}`} /></Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6, md: 3 }}><Stat label="Partitions quorum" value={`${data.partitionsQuorum}/${data.partitions}`} /></Grid.Col>
          </Grid>
        </>
      )}
    </Stack>
  )
}
```

- [ ] **Step 2: Create `web/src/pages/SettingsPage.tsx`**

```tsx
import { useState } from 'react'
import {
  Button, Card, Checkbox, Group, Modal, Stack, Table, TextInput, Title, Badge, ActionIcon,
} from '@mantine/core'
import { IconTrash, IconPlus } from '@tabler/icons-react'
import { useDisclosure } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type Cluster } from '../api/client'
import { useAuth } from '../auth/AuthContext'

interface FormState {
  name: string; admin_endpoint: string; admin_token: string
  s3_endpoint: string; s3_region: string; s3_access_key: string; s3_secret_key: string
  is_default: boolean
}

const empty: FormState = {
  name: '', admin_endpoint: 'http://192.168.101.8:3903', admin_token: '',
  s3_endpoint: 'http://192.168.101.8:3900', s3_region: 'garage',
  s3_access_key: '', s3_secret_key: '', is_default: true,
}

export function SettingsPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const qc = useQueryClient()
  const [opened, { open, close }] = useDisclosure(false)
  const [form, setForm] = useState<FormState>(empty)

  const { data: clusters } = useQuery({
    queryKey: ['clusters'],
    queryFn: async () => (await api.get<Cluster[]>('/clusters')).data,
  })

  const createMut = useMutation({
    mutationFn: async (f: FormState) => (await api.post('/clusters', f)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clusters'] })
      notifications.show({ color: 'green', message: 'Đã thêm cluster' })
      close(); setForm(empty)
    },
    onError: () => notifications.show({ color: 'red', message: 'Thêm cluster thất bại' }),
  })

  const deleteMut = useMutation({
    mutationFn: async (id: number) => api.delete(`/clusters/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clusters'] }),
  })

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={3}>Cluster connections</Title>
        {isAdmin && <Button leftSection={<IconPlus size={16} />} onClick={open}>Thêm cluster</Button>}
      </Group>

      <Card withBorder>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Tên</Table.Th><Table.Th>Admin endpoint</Table.Th>
              <Table.Th>S3 endpoint</Table.Th><Table.Th>Mặc định</Table.Th><Table.Th /></Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {clusters?.map((c) => (
              <Table.Tr key={c.id}>
                <Table.Td>{c.name}</Table.Td>
                <Table.Td>{c.admin_endpoint}</Table.Td>
                <Table.Td>{c.s3_endpoint}</Table.Td>
                <Table.Td>{c.is_default && <Badge color="green">default</Badge>}</Table.Td>
                <Table.Td>
                  {isAdmin && (
                    <ActionIcon color="red" variant="subtle" onClick={() => deleteMut.mutate(c.id)} aria-label="delete">
                      <IconTrash size={16} />
                    </ActionIcon>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>

      <Modal opened={opened} onClose={close} title="Thêm cluster">
        <Stack>
          <TextInput label="Tên" value={form.name} onChange={(e) => setForm({ ...form, name: e.currentTarget.value })} required />
          <TextInput label="Admin endpoint" value={form.admin_endpoint} onChange={(e) => setForm({ ...form, admin_endpoint: e.currentTarget.value })} required />
          <TextInput label="Admin token" value={form.admin_token} onChange={(e) => setForm({ ...form, admin_token: e.currentTarget.value })} required />
          <TextInput label="S3 endpoint" value={form.s3_endpoint} onChange={(e) => setForm({ ...form, s3_endpoint: e.currentTarget.value })} />
          <TextInput label="S3 region" value={form.s3_region} onChange={(e) => setForm({ ...form, s3_region: e.currentTarget.value })} />
          <TextInput label="S3 access key" value={form.s3_access_key} onChange={(e) => setForm({ ...form, s3_access_key: e.currentTarget.value })} />
          <TextInput label="S3 secret key" value={form.s3_secret_key} onChange={(e) => setForm({ ...form, s3_secret_key: e.currentTarget.value })} />
          <Checkbox label="Đặt làm mặc định" checked={form.is_default} onChange={(e) => setForm({ ...form, is_default: e.currentTarget.checked })} />
          <Button onClick={() => createMut.mutate(form)} loading={createMut.isPending}>Lưu</Button>
        </Stack>
      </Modal>
    </Stack>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/DashboardPage.tsx web/src/pages/SettingsPage.tsx
git commit -m "feat: add dashboard and settings pages"
```

---

## Task 20: Build frontend, re-embed, verify UI with Playwright MCP

**Files:**
- Modify: `web/dist/*` (generated)

- [ ] **Step 1: Build the frontend**

Run:
```bash
cd web && npm run build
```
Expected: `web/dist/` populated (real `index.html` + hashed JS/CSS), no TS errors.

- [ ] **Step 2: Rebuild the Go binary (re-embeds the new dist)**

Run:
```bash
cd /Users/hunghd/Repositories/garage-admin && go build ./...
```
Expected: builds clean.

- [ ] **Step 3: Run the server**

Run:
```bash
APP_SECRET_KEY=0123456789abcdef0123456789abcdef \
APP_DB_PATH=./tmp/app.db APP_PORT=8080 \
ADMIN_USER=admin ADMIN_PASSWORD=admin123 \
go run ./cmd/garage-admin
```
Leave running.

- [ ] **Step 4: Verify UI with Playwright MCP**

Using the Playwright MCP tools:
1. `browser_navigate` → `http://localhost:8080/` → expect redirect to `/login`.
2. `browser_snapshot` → confirm the login form (Tài khoản / Mật khẩu fields).
3. `browser_type` username `admin`, password `admin123`; `browser_click` "Đăng nhập".
4. `browser_snapshot` → confirm Dashboard with the AppShell navbar.
5. Navigate to Settings, `browser_click` "Thêm cluster", `browser_fill_form` with the real
   Garage endpoint + admin token, submit; confirm the cluster row appears.
6. Return to Dashboard; confirm cluster health badge shows `healthy`.
7. `browser_take_screenshot` for the record.
8. Exercise the ThemeSwitcher (select "Ocean", toggle dark) and screenshot to confirm theming.

Expected: full login → settings → dashboard flow works end-to-end against the real cluster.
Stop the server and `rm -rf ./tmp` afterward.

- [ ] **Step 5: Commit the built assets**

```bash
git add web/dist
git commit -m "build: compile frontend and embed into binary"
```

Note: committing `web/dist` keeps `go build` working without a Node step locally. CI rebuilds
it fresh (Task 22). The `.gitignore` from Task 0 ignores `web/dist/`; force-add for this commit
with `git add -f web/dist` OR remove the `web/dist/` line from `.gitignore`. **Decision:** remove
`web/dist/` from `.gitignore` so the embedded assets are tracked. Edit `.gitignore` accordingly
and include it in this commit.

---

## Task 21: Dockerfile (multi-stage, arm/v7)

**Files:**
- Create: `Dockerfile`, `.dockerignore`

- [ ] **Step 1: Create `.dockerignore`**

```
.git
tmp
*.db
web/node_modules
docs
```

- [ ] **Step 2: Create `Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1

# --- Stage 1: build frontend ---
FROM node:20-alpine AS frontend
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# --- Stage 2: build Go binary ---
FROM golang:1.22-alpine AS backend
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
# Bring in freshly built frontend so go:embed picks it up.
COPY --from=frontend /web/dist ./web/dist
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
```

- [ ] **Step 3: Build locally for arm/v7 to verify cross-compile**

Run:
```bash
docker buildx build --platform linux/arm/v7 -t garage-admin:test --load .
```
Expected: build succeeds (image produced). If `--load` fails for single-arch on your setup,
use `--output type=docker`.

- [ ] **Step 4: Smoke-run the image (amd64 for local quickness)**

Run:
```bash
docker buildx build --platform linux/amd64 -t garage-admin:local --load .
docker run --rm -e APP_SECRET_KEY=0123456789abcdef0123456789abcdef \
  -e ADMIN_USER=admin -e ADMIN_PASSWORD=admin123 -p 8080:8080 garage-admin:local &
sleep 2 && curl -s localhost:8080/api/health   # -> {"status":"ok"}
docker stop $(docker ps -q --filter ancestor=garage-admin:local)
```
Expected: health responds.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "build: add multi-stage Dockerfile for arm/v7"
```

---

## Task 22: GitHub Actions → GHCR

**Files:**
- Create: `.github/workflows/docker.yml`

- [ ] **Step 1: Create the workflow**

```yaml
name: build-image

on:
  push:
    branches: [main]
    tags: ['v*']

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  docker:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4

      - name: Set up QEMU
        uses: docker/setup-qemu-action@v3

      - name: Set up Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Docker metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=ref,event=branch
            type=semver,pattern={{version}}
            type=sha

      - name: Build and push
        uses: docker/build-push-action@v6
        with:
          context: .
          platforms: linux/arm/v7,linux/amd64
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

- [ ] **Step 2: Validate YAML locally**

Run:
```bash
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/docker.yml')); print('ok')"
```
Expected: prints `ok`.

- [ ] **Step 3: Commit and push to trigger CI**

```bash
git add .github/workflows/docker.yml
git commit -m "ci: build and push multi-arch image to GHCR"
git push -u origin main
```
Expected: GitHub Actions run starts; after it finishes, `ghcr.io/<owner>/garage-admin:main`
and `:sha-...` exist (multi-arch `linux/arm/v7` + `linux/amd64`).

- [ ] **Step 4: Verify the published image on the NAS (manual)**

On the NAS (arm32v7):
```bash
docker run -d --name garage-admin -p 8080:8080 \
  -e APP_SECRET_KEY=<32-byte-key> \
  -e ADMIN_USER=admin -e ADMIN_PASSWORD=<pw> \
  -v /volume1/garage-admin:/data \
  ghcr.io/<owner>/garage-admin:main
curl -s localhost:8080/api/health   # -> {"status":"ok"}
```
Expected: container runs on the NAS, health responds, login works.

---

## Self-Review

**Spec coverage (Phase 1 scope):**
- Single Go binary embedding SPA → Tasks 14, 15, 20. ✓
- SQLite (modernc, pure-Go) + migrations → Tasks 3–6. ✓
- AES-256-GCM encrypted secrets via `APP_SECRET_KEY` → Tasks 2, 12. ✓
- Auth/session + 2 roles (admin/readonly), defense-in-depth backend role check → Tasks 7, 8, 11, 12. ✓
- Cluster connections CRUD in Settings, multi-cluster, default selection → Tasks 5, 12, 19. ✓
- Garage Admin API v2 client (basic status/health) → Tasks 9, 13. ✓
- Bootstrap admin → Task 15. ✓
- Theming (5 presets + light/dark) → Tasks 17, 18. ✓
- Dockerfile arm/v7 → Task 21. ✓
- GitHub Actions → GHCR multi-arch → Task 22. ✓
- Live verification against `192.168.101.8:3903` → Tasks 15, 20. ✓
- UI verification via Playwright MCP → Task 20. ✓

Phases 2–6 (full bucket/key/cluster-layout/node/block/admin-token/file-browser/users) are
intentionally out of this plan and get their own plans after Phase 1 lands.

**Placeholder scan:** No TBD/TODO. Every code step shows complete code.

**Type consistency:** `db.User`, `db.Cluster`, `db.Session` field names match across repo and
API. `garage.Client.GetClusterHealth`/`GetClusterStatus` match handler usage in Task 13.
Frontend `ClusterHealth`/`Cluster`/`User` types match the JSON the handlers emit (`clusterView`,
`userView`, `ClusterHealth` JSON tags). Cookie name `ga_session`, theme key `ga_theme`,
secret length 32 are consistent throughout.
