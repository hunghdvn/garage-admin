# Usage History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Snapshot cluster and per-bucket usage every hour into SQLite and chart it (hourly for 24h, daily for 7d–1y) on the Dashboard and the bucket detail page.

**Architecture:** A background goroutine (`internal/usage.Collector`) polls every configured cluster through the existing Garage Admin API client and upserts hour-aligned rows into two new tables. Read endpoints under `/api/usage` select rows for a range and, for multi-day ranges, keep the last row of each *browser-local* day. A React `UsageChart` component (`@mantine/charts`) renders them.

**Tech Stack:** Go 1.25, chi, modernc sqlite; React 18 + Mantine 7.17.8 + `@mantine/charts` 7.17.8 (+ `recharts` 2.x peer), react-query.

**Spec:** `docs/superpowers/specs/2026-11-13-usage-history-design.md`

## Global Constraints

- Work on branch `feat/usage-history`; do not push or merge to `main` without the user's go-ahead.
- Timestamps stored as Unix seconds (UTC), truncated to the hour.
- Hourly rows kept 31 days; older rows compacted to the last row of each UTC day, kept forever.
- Ranges: `24h` (hourly), `7d`, `30d`, `90d`, `365d` (daily). UI labels: `24 giờ · 7 ngày · 30 ngày · 90 ngày · 1 năm`.
- `tzOffset` query param = minutes **east** of UTC (browser sends `-new Date().getTimezoneOffset()`), valid range −840..840, default 0.
- Usage read endpoints require login only (`readonly` allowed).
- UI copy in Vietnamese, matching existing pages. Must still work on the 1 GB ARMv7 NAS (no new services, no CGo).
- Go tests: `cd src && go test ./...`. Frontend has no test runner: verify with `cd src/web && npx tsc -b && npm run build`, then commit `src/internal/web/dist`.

## Review Focus

1. One unreachable cluster must not stop the others from being recorded, nor crash the app → Task 4 test `TestCollectSkipsFailingCluster`.
2. A restart in the same hour must not duplicate rows → Task 1 test `TestSaveClusterUsageUpsertsSameHour`.
3. A snapshot at 20:00 UTC belongs to the *next* day in UTC+7 → Task 3 test `TestLastPerDayUsesLocalDay`.
4. Garage < v2.5 (no `ListBucketsInfo`) must still record buckets → Task 2 test `TestListBucketsDetailedFallsBack`.
5. Deleting a cluster in Settings removes its history (FK cascade) → Task 1 test `TestUsageDeletedWithCluster`.

---

### Task 1: Usage tables and repository

**Files:**
- Create: `src/internal/db/migrations/0002_usage.sql`
- Create: `src/internal/db/usage.go`
- Test: `src/internal/db/usage_test.go`

**Interfaces:**
- Produces:
  ```go
  type ClusterUsage struct {
      TS          int64 `json:"ts"`
      Bytes       int64 `json:"bytes"`
      Objects     int64 `json:"objects"`
      DataAvail   int64 `json:"dataAvail"`
      BucketCount int64 `json:"bucketCount"`
  }
  type BucketUsage struct {
      BucketID string `json:"-"`
      TS       int64  `json:"ts"`
      Alias    string `json:"alias"`
      Bytes    int64  `json:"bytes"`
      Objects  int64  `json:"objects"`
  }
  func (d *DB) SaveClusterUsage(clusterID int64, u ClusterUsage) error
  func (d *DB) SaveBucketUsage(clusterID int64, rows []BucketUsage) error // one transaction
  func (d *DB) ClusterUsageSince(clusterID, since int64) ([]ClusterUsage, error)              // ts >= since, ascending
  func (d *DB) BucketUsageSince(clusterID int64, bucketID string, since int64) ([]BucketUsage, error) // ascending
  func (d *DB) CompactUsage(cutoff int64) error
  ```

Schema: `cluster_usage(cluster_id, ts, bytes, objects, data_avail, bucket_count)` PK `(cluster_id, ts)`; `bucket_usage(cluster_id, bucket_id, ts, alias, bytes, objects)` PK `(cluster_id, bucket_id, ts)`; both `cluster_id INTEGER NOT NULL REFERENCES clusters(id) ON DELETE CASCADE`. Use `CREATE TABLE IF NOT EXISTS` (migrations re-run on every start). Saves are `INSERT … ON CONFLICT DO UPDATE`.

- [ ] **Step 1: Write the failing tests**

```go
func TestSaveClusterUsageUpsertsSameHour(t *testing.T) {
	// save {TS:3600, Bytes:10} then {TS:3600, Bytes:20}; ClusterUsageSince(id, 0) → exactly 1 row, Bytes 20
}
func TestClusterUsageSinceFiltersAndOrders(t *testing.T) {
	// save TS 7200, 0, 3600 → ClusterUsageSince(id, 3600) returns TS [3600, 7200]
}
func TestBucketUsageIsPerBucket(t *testing.T) {
	// SaveBucketUsage(id, [{b1,TS:0,Bytes:1},{b2,TS:0,Bytes:2}]) → BucketUsageSince(id,"b1",0) has 1 row Bytes 1
}
func TestCompactUsageKeepsLastRowPerUTCDay(t *testing.T) {
	// cluster rows at TS 0, 3600, 82800 (day 0) and 86400, 90000 (day 1); bucket rows at the same TS for b1
	// CompactUsage(86400) → cluster TS [82800, 86400, 90000]; bucket b1 TS [82800, 86400, 90000]
}
func TestUsageDeletedWithCluster(t *testing.T) {
	// save cluster + bucket rows, DeleteCluster(id) → both Since(...) queries return 0 rows
}
```

- [ ] **Step 2: Run** `cd src && go test ./internal/db -run Usage` — Expected: FAIL (undefined methods).
- [ ] **Step 3: Implement** migration and `usage.go`. `CompactUsage(cutoff)`: for rows with `ts < cutoff`, delete all but the max `ts` per `(cluster_id, ts/86400)` (and per `bucket_id` for buckets).
- [ ] **Step 4: Run** `cd src && go test ./internal/db` — Expected: PASS (whole package).
- [ ] **Step 5: Commit** `feat(db): usage history tables`

### Task 2: Garage helpers for collecting bucket usage

**Files:**
- Modify: `src/internal/garage/buckets.go` (add method), `src/internal/garage/client.go` (add `IsUnsupportedEndpoint`)
- Modify: `src/internal/api/buckets.go`, `src/internal/api/keys.go` (replace private `unsupportedEndpoint` with `garage.IsUnsupportedEndpoint`, delete the private one)
- Test: `src/internal/garage/list_info_test.go`

**Interfaces:**
- Produces:
  ```go
  func IsUnsupportedEndpoint(err error) bool // APIError with status 400 or 404 (moved from api)
  func (c *Client) ListBucketsDetailed() ([]BucketInfo, error)
  // ListBucketsInfo; if IsUnsupportedEndpoint → ListBuckets then GetBucketInfo per bucket
  ```

- [ ] **Step 1: Write the failing tests** `TestListBucketsDetailedUsesListBucketsInfo` (fake serves only `/v2/ListBucketsInfo` with 2 buckets → 2 results with bytes) and `TestListBucketsDetailedFallsBack` (`/v2/ListBucketsInfo` → 400 Unknown API endpoint; `/v2/ListBuckets` → `[{"id":"b1"}]`; `/v2/GetBucketInfo` with `id=b1` → bytes 42 → result `[{ID:"b1", Bytes:42}]`).
- [ ] **Step 2: Run** `cd src && go test ./internal/garage -run ListBucketsDetailed` — Expected: FAIL.
- [ ] **Step 3: Implement**, then switch the api package to `garage.IsUnsupportedEndpoint`.
- [ ] **Step 4: Run** `cd src && go test ./...` — Expected: PASS (existing fallback tests in `internal/api/list_info_test.go` still green).
- [ ] **Step 5: Commit** `refactor(garage): shared unsupported-endpoint check; add ListBucketsDetailed`

### Task 3: Range and day-grouping helpers

**Files:**
- Create: `src/internal/usage/series.go`
- Test: `src/internal/usage/series_test.go`

**Interfaces:**
- Produces:
  ```go
  type Granularity string // "hour" | "day"
  var ErrBadRange = errors.New("invalid range")
  // RangeStart returns the first ts to include and the granularity.
  // "24h": now truncated to the hour minus 23h, hour.
  // "7d","30d","90d","365d": start of the local day (offsetSec east of UTC) of now, minus (n-1) days, day.
  func RangeStart(now time.Time, rng string, offsetSec int) (int64, Granularity, error)
  // LastPerDay keeps, from rows sorted ascending by ts, the last row of each local day floor((ts+offsetSec)/86400).
  func LastPerDay[T any](rows []T, ts func(T) int64, offsetSec int) []T
  func UntilNextHour(now time.Time) time.Duration
  ```

- [ ] **Step 1: Write the failing tests**
  - `TestRangeStart24h`: now `2026-11-13T10:25:00Z` → `2026-11-12T11:00:00Z`, `"hour"`.
  - `TestRangeStart7dLocal`: now `2026-11-13T20:00:00Z`, offset `25200` (local is 14/11 03:00) → `2026-11-07T17:00:00Z` (= 08/11 00:00 local), `"day"`.
  - `TestRangeStartRejectsUnknown`: `"2d"` → `ErrBadRange`.
  - `TestLastPerDayUsesLocalDay`: ts `2026-11-13T16:00Z`, `T19:00Z`, `T20:00Z` with offset 25200 → keeps `T16:00Z` (last of 13/11 local, 23:00) and `T20:00Z` (14/11 local).
  - `TestUntilNextHour`: `10:25:30` → `34m30s`.
- [ ] **Step 2: Run** `cd src && go test ./internal/usage` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(usage): range and per-day grouping helpers`

### Task 4: Collector and startup wiring

**Files:**
- Create: `src/internal/usage/collector.go`
- Modify: `src/cmd/garage-admin/main.go` (start `go (&usage.Collector{DB: database, Cipher: cipher}).Run(context.Background())` after the cipher is built)
- Test: `src/internal/usage/collector_test.go`

**Interfaces:**
- Consumes: Task 1 `Save*Usage`, `CompactUsage`; Task 2 `ListBucketsDetailed`; existing `db.ListClusters`, `crypto.Cipher.Decrypt`, `garage.New`, `GetClusterStatistics`.
- Produces:
  ```go
  type Collector struct {
      DB     *db.DB
      Cipher *crypto.Cipher
      Now    func() time.Time // nil → time.Now
  }
  func (c *Collector) CollectOnce()            // all clusters, then CompactUsage(start of UTC day of now-31d)
  func (c *Collector) Run(ctx context.Context) // CollectOnce now, then at each hour boundary until ctx is done
  ```

Per cluster: ts = `Now().UTC().Truncate(time.Hour).Unix()`; cluster row from `GetClusterStatistics` (`TotalObjectBytes`, `TotalObjectCount`, `DataAvail`, `BucketCount`); bucket rows from `ListBucketsDetailed` (alias = first global alias or `""`). Any error for a cluster → `log.Printf("usage: cluster %d (%s): %v", …)` and continue with the next cluster. No log line on success.

- [ ] **Step 1: Write the failing tests**
  - `TestCollectOnceRecordsClusterAndBuckets`: fake Garage (stats bytes 1000/objects 5/dataAvail 9000/bucketCount 1; `ListBucketsInfo` one bucket `b1` alias `files` bytes 1000); `Now` = `2026-11-13T10:25:00Z` → one cluster row with TS of `10:00Z` and those values; one bucket row `b1`, alias `files`.
  - `TestCollectSkipsFailingCluster`: cluster A points at a closed `httptest` server, cluster B at the fake → B has a row, A has none, no panic.
- [ ] **Step 2: Run** `cd src && go test ./internal/usage -run Collect` — Expected: FAIL.
- [ ] **Step 3: Implement** collector and main wiring (`Run` uses `UntilNextHour`).
- [ ] **Step 4: Run** `cd src && go test ./... && go vet ./...` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(usage): hourly collector`

### Task 5: Usage read API

**Files:**
- Create: `src/internal/api/usage.go` (`mountUsage`, registered in `Routes()` in `server.go`)
- Test: `src/internal/api/usage_test.go`

**Interfaces:**
- Consumes: Task 1 `*UsageSince`; Task 3 `RangeStart`, `LastPerDay`; existing `clusterForRequest`.
- Produces (JSON; cluster chosen by the existing `?cluster=` param or default):
  - `GET /api/usage/cluster?range=&tzOffset=` → `{"granularity":"hour"|"day","points":[ClusterUsage…]}`
  - `GET /api/usage/buckets/{id}?range=&tzOffset=` → `{"granularity":…,"points":[{ts,alias,bytes,objects}…]}`
  - `points` is `[]` (never `null`) when empty. Bad `range` or `tzOffset` → 400. No cluster → 400 `"no cluster configured"`.

- [ ] **Step 1: Write the failing tests** (use `newGarageBackedAPI` with role `readonly`; the fake Garage is never called. Seed rows directly through the test's DB handle: extend the helper or add a sibling that also returns `*db.DB` and the cluster id.)
  - `TestUsageCluster24hHourly`: rows at now−1h and now−30h → `granularity "hour"`, 1 point.
  - `TestUsageCluster7dDaily` (`tzOffset=420`; D = start of the local day 2 days ago): rows at D+1h, D+2h, D+3h and at D−23h → 2 points; the second point's `bytes` equals the D+3h row.
  - `TestUsageBucketScopedToBucket`: rows for `b1` and `b2` → `/api/usage/buckets/b1?range=7d` only returns `b1` values.
  - `TestUsageRejectsBadRange`: `range=2d` → 400; `tzOffset=abc` → 400.
  - `TestUsageEmptyIsArray`: no rows → body contains `"points":[]`.
- [ ] **Step 2: Run** `cd src && go test ./internal/api -run Usage` — Expected: FAIL (404s).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `cd src && go test ./...` — Expected: PASS (including `completeness_test.go`; if it enumerates routes, add the new ones there).
- [ ] **Step 5: Commit** `feat(api): usage history endpoints`

### Task 6: Charts in the UI

Load the `dataviz` skill before writing chart code.

**Files:**
- Modify: `src/web/package.json` (add `@mantine/charts@7.17.8`, `recharts@^2.13`), `src/web/src/main.tsx` (import `@mantine/charts/styles.css`)
- Modify: `src/web/src/api/client.ts` (types `UsageRange`, `ClusterUsagePoint`, `BucketUsagePoint`, `UsageSeries<T>`)
- Create: `src/web/src/components/UsageChart.tsx`
- Modify: `src/web/src/pages/DashboardPage.tsx`, `src/web/src/pages/BucketDetailPage.tsx`
- Modify: `README.md`, `README.vi.md` (one feature bullet under **Cluster**, one under **Buckets**)
- Rebuild: `src/internal/web/dist`

**Interfaces:**
- Consumes: Task 5 endpoints.
- Produces: `export function UsageChart(props: { kind: 'cluster' } | { kind: 'bucket'; bucketId: string })`.

Behaviour:
- A card titled `Lịch sử dung lượng`.
  - Range control: `24 giờ · 7 ngày · 30 ngày · 90 ngày · 1 năm`, default `7 ngày`.
  - Metric control: `Dung lượng | Objects`.
- React-query key: `['usage', kind, bucketId, range]`. Cluster switch already invalidates all queries.
- X labels: hour granularity → `HH:00`; day granularity → `dd/MM`. Both use the browser's local time.
- Values:
  - Bytes use the existing `fmtBytes`.
  - Cluster "Dung lượng" plots two series: `Đã dùng` (`bytes`) and `Còn trống` (`dataAvail`).
  - Bucket "Dung lượng" plots `bytes` only.
  - "Objects" plots `objects`.
- Empty `points` → dimmed text `Chưa có số liệu. garage-admin ghi lại dung lượng mỗi giờ một lần.` and no chart.
- Placement:
  - Dashboard: below the stat grid.
  - Bucket detail: below the 4 stat cards.
- Must not overflow at 375 px width.

- [ ] **Step 1: Install deps**: `cd src/web && npm install @mantine/charts@7.17.8 recharts@^2.13`.
- [ ] **Step 2: Implement** types, component, page integration, README bullets.
- [ ] **Step 3: Verify** `cd src/web && npx tsc -b && npm run build` — Expected: no errors; `src/internal/web/dist` updated.
- [ ] **Step 4: Visual check**:
  - Run the binary locally against a scratch fake-Garage stub, with ~90 days of seeded rows inserted via `sqlite3`.
  - Use Playwright to screenshot the Dashboard and a bucket page at 1280 px and 375 px, for `24 giờ` and `90 ngày`, in light and dark mode.
  - Check: labels readable, tooltips formatted, and no horizontal page scroll.
- [ ] **Step 5: Commit** `feat(web): usage history charts` (include `src/internal/web/dist`).

### Task 7: Real-cluster check on the NAS

- [ ] **Step 1:** Build an `linux/arm/v7` image from the branch and run it as a temporary container on the NAS at `:3910`:
  - Use a fresh DB and the bootstrap admin.
  - Join network `s3-net`.
  - Add the `H2D-NAS` cluster through the API.
- [ ] **Step 2:** Confirm `GET /api/usage/cluster?range=24h` and `/api/usage/buckets/<files id>?range=24h` each return 1 point matching `GetClusterStatistics` / `GetBucketInfo`, and container logs show no `usage:` errors.
- [ ] **Step 3:** Remove the temp container and its data. Report to the user and ask before merging to `main` and pushing (which redeploys via CI).
