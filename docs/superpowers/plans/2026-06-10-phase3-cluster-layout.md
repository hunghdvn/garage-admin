# Phase 3 — Cluster & Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a Cluster admin area: a live overview (health, statistics, node list) and full layout management (view current layout + staged changes + version history; stage role changes, preview, apply with version confirmation, revert; connect new nodes) — all on top of Phases 1–2.

**Architecture:** Extend the Garage Admin API v2 client (`internal/garage`) with statistics, layout, history, update/preview/apply/revert, and connect operations. Add `internal/api` handlers under `/api/cluster/*` (reads: auth; mutations: admin-only) routed to the selected cluster via the existing `garageClientForRequest`. Add a React `ClusterPage` (Overview + Layout tabs) and nav link. Read paths verified live against Garage v2.3.0; layout mutations are designed with preview-before-apply and a mandatory version confirmation, and are left for the user to exercise on their real cluster.

**Tech stack:** Same as Phases 1–2. No new dependencies.

**Branch:** `phase3-cluster-layout` (off `phase2-buckets-keys`). Module root `src/`; run `go` from `src/`.

**Verified API contract (Garage v2.3.0, observed live):**
- `GET /v2/GetClusterStatistics` → `{freeform, dataAvail, metadataAvail, incompleteAvailInfo, bucketCount, totalObjectCount, totalObjectBytes}`
- `GET /v2/GetClusterLayout` → `{version, roles[{id, zone, tags[], capacity, storedPartitions, usableCapacity}], parameters{zoneRedundancy}, partitionSize, stagedRoleChanges[], stagedParameters}`
- `GET /v2/GetClusterLayoutHistory` → `{currentVersion, minAck, versions[{version, status, storageNodes, gatewayNodes}], updateTrackers}`
- `POST /v2/PreviewClusterLayoutChanges` → `{message:[string...], newLayout:{...}}`
- `POST /v2/UpdateClusterLayout` body = **array** of `{nodeId, zone, capacity|null, tags[], remove?}` (all of zone/capacity/tags required per node) → returns updated layout
- `POST /v2/ApplyClusterLayout` body `{version}` (mandatory safety check) → `{message:[...], layout?}`
- `POST /v2/RevertClusterLayout` body `{}` → updated layout
- `POST /v2/ConnectClusterNodes` body = array of `"<node_id>@<host:port>"` → array of per-node results
- `GET /v2/GetClusterStatus` (Phase 1) → `{layoutVersion, nodes[{id, hostname, addr, isUp, draining, lastSeenSecsAgo, garageVersion, role{zone,capacity,tags}, dataPartition{available,total}, metadataPartition{available,total}}]}`

---

## File Structure

```
src/internal/garage/cluster.go        # NEW: statistics/layout/history/update/preview/apply/revert/connect (+ cluster_test.go)
src/internal/api/cluster_layout.go     # NEW: /api/cluster/statistics + /api/cluster/layout/* + /api/cluster/connect (+ cluster_layout_test.go)
src/internal/api/cluster_status.go     # MODIFY: mount the new sub-routes inside the existing /cluster group
src/web/src/api/client.ts              # MODIFY: add cluster/layout TS types
src/web/src/pages/ClusterPage.tsx       # NEW: Overview + Layout tabs
src/web/src/components/ClusterOverview.tsx  # NEW
src/web/src/components/ClusterLayout.tsx    # NEW
src/web/src/components/AppShell.tsx     # MODIFY: add Cluster nav link
src/web/src/App.tsx                     # MODIFY: add /cluster route
```

---

## Task 1: Garage client — cluster statistics & layout operations

**Files:** Create `src/internal/garage/cluster.go`, `src/internal/garage/cluster_test.go`

- [ ] **Step 1: Write `src/internal/garage/cluster_test.go`**

```go
package garage

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGetClusterStatistics(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v2/GetClusterStatistics" {
			t.Errorf("path=%q", r.URL.Path)
		}
		w.Write([]byte(`{"freeform":"hi","dataAvail":100,"metadataAvail":50,"incompleteAvailInfo":false,"bucketCount":1,"totalObjectCount":2,"totalObjectBytes":3}`))
	}))
	defer srv.Close()
	got, err := New(srv.URL, "t").GetClusterStatistics()
	if err != nil {
		t.Fatal(err)
	}
	if got.BucketCount != 1 || got.DataAvail != 100 || got.Freeform != "hi" {
		t.Errorf("got %+v", got)
	}
}

func TestGetClusterLayout(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"version":1,"roles":[{"id":"n1","zone":"dc1","tags":[],"capacity":700,"storedPartitions":256,"usableCapacity":700}],"parameters":{"zoneRedundancy":"maximum"},"partitionSize":27,"stagedRoleChanges":[],"stagedParameters":null}`))
	}))
	defer srv.Close()
	got, err := New(srv.URL, "t").GetClusterLayout()
	if err != nil {
		t.Fatal(err)
	}
	if got.Version != 1 || len(got.Roles) != 1 || got.Roles[0].Zone != "dc1" {
		t.Errorf("got %+v", got)
	}
}

func TestGetClusterLayoutHistory(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"currentVersion":1,"minAck":1,"versions":[{"version":1,"status":"Current","storageNodes":1,"gatewayNodes":0}],"updateTrackers":null}`))
	}))
	defer srv.Close()
	got, err := New(srv.URL, "t").GetClusterLayoutHistory()
	if err != nil {
		t.Fatal(err)
	}
	if got.CurrentVersion != 1 || len(got.Versions) != 1 || got.Versions[0].Status != "Current" {
		t.Errorf("got %+v", got)
	}
}

func TestUpdateClusterLayoutSendsArray(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v2/UpdateClusterLayout" || r.Method != http.MethodPost {
			t.Errorf("path=%q method=%q", r.URL.Path, r.Method)
		}
		var arr []NodeRoleChange
		b, _ := io.ReadAll(r.Body)
		if err := json.Unmarshal(b, &arr); err != nil {
			t.Fatalf("body not an array: %s", b)
		}
		if len(arr) != 1 || arr[0].NodeID != "n1" || arr[0].Capacity == nil || *arr[0].Capacity != 500 {
			t.Errorf("arr=%+v", arr)
		}
		w.Write([]byte(`{"version":1,"roles":[],"parameters":{"zoneRedundancy":"maximum"},"partitionSize":1,"stagedRoleChanges":[{"id":"n1","remove":false,"zone":"dc1","capacity":500,"tags":[]}],"stagedParameters":null}`))
	}))
	defer srv.Close()
	cap500 := int64(500)
	got, err := New(srv.URL, "t").UpdateClusterLayout([]NodeRoleChange{{NodeID: "n1", Zone: "dc1", Capacity: &cap500, Tags: []string{}}})
	if err != nil {
		t.Fatal(err)
	}
	if len(got.StagedRoleChanges) != 1 {
		t.Errorf("got %+v", got)
	}
}

func TestPreviewApplyRevertConnect(t *testing.T) {
	var paths []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path)
		switch r.URL.Path {
		case "/v2/PreviewClusterLayoutChanges":
			w.Write([]byte(`{"message":["line1","line2"],"newLayout":{"version":2}}`))
		case "/v2/ApplyClusterLayout":
			var body map[string]int
			b, _ := io.ReadAll(r.Body)
			json.Unmarshal(b, &body)
			if body["version"] != 2 {
				t.Errorf("apply version=%v", body)
			}
			w.Write([]byte(`{"message":["applied"]}`))
		case "/v2/RevertClusterLayout":
			w.Write([]byte(`{"version":1,"roles":[],"parameters":{"zoneRedundancy":"maximum"},"partitionSize":1,"stagedRoleChanges":[],"stagedParameters":null}`))
		case "/v2/ConnectClusterNodes":
			var arr []string
			b, _ := io.ReadAll(r.Body)
			json.Unmarshal(b, &arr)
			if len(arr) != 1 || arr[0] != "n1@1.2.3.4:3901" {
				t.Errorf("connect body=%v", arr)
			}
			w.Write([]byte(`[{"success":true,"error":null}]`))
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()
	c := New(srv.URL, "t")
	prev, err := c.PreviewClusterLayoutChanges()
	if err != nil || len(prev.Message) != 2 {
		t.Fatalf("preview err=%v prev=%+v", err, prev)
	}
	if _, err := c.ApplyClusterLayout(2); err != nil {
		t.Fatal(err)
	}
	if _, err := c.RevertClusterLayout(); err != nil {
		t.Fatal(err)
	}
	res, err := c.ConnectClusterNodes([]string{"n1@1.2.3.4:3901"})
	if err != nil {
		t.Fatal(err)
	}
	if len(res) != 1 || !res[0].Success {
		t.Errorf("connect res=%+v", res)
	}
	want := []string{"/v2/PreviewClusterLayoutChanges", "/v2/ApplyClusterLayout", "/v2/RevertClusterLayout", "/v2/ConnectClusterNodes"}
	for i, p := range want {
		if paths[i] != p {
			t.Errorf("paths[%d]=%q want %q", i, paths[i], p)
		}
	}
}
```

- [ ] **Step 2: Run `go test ./internal/garage/ -run Cluster` — confirm FAIL.**

- [ ] **Step 3: Write `src/internal/garage/cluster.go`**

```go
package garage

import (
	"context"
	"encoding/json"
	"net/http"
)

// ClusterStatistics mirrors GetClusterStatistics.
type ClusterStatistics struct {
	Freeform            string `json:"freeform"`
	DataAvail           int64  `json:"dataAvail"`
	MetadataAvail       int64  `json:"metadataAvail"`
	IncompleteAvailInfo bool   `json:"incompleteAvailInfo"`
	BucketCount         int64  `json:"bucketCount"`
	TotalObjectCount    int64  `json:"totalObjectCount"`
	TotalObjectBytes    int64  `json:"totalObjectBytes"`
}

// LayoutRole is a node's role in the current layout.
type LayoutRole struct {
	ID               string   `json:"id"`
	Zone             string   `json:"zone"`
	Tags             []string `json:"tags"`
	Capacity         *int64   `json:"capacity"`
	StoredPartitions int      `json:"storedPartitions"`
	UsableCapacity   *int64   `json:"usableCapacity"`
}

// StagedRoleChange is a pending (not-yet-applied) role change.
type StagedRoleChange struct {
	ID       string   `json:"id"`
	Remove   bool     `json:"remove"`
	Zone     string   `json:"zone"`
	Capacity *int64   `json:"capacity"`
	Tags     []string `json:"tags"`
}

// ClusterLayout mirrors GetClusterLayout. ZoneRedundancy is left raw because it
// may be the string "maximum" or an object like {"atLeast":2}.
type ClusterLayout struct {
	Version           int                `json:"version"`
	Roles             []LayoutRole       `json:"roles"`
	Parameters        json.RawMessage    `json:"parameters"`
	PartitionSize     int64              `json:"partitionSize"`
	StagedRoleChanges []StagedRoleChange `json:"stagedRoleChanges"`
	StagedParameters  json.RawMessage    `json:"stagedParameters"`
}

// LayoutVersionInfo is one entry in the layout history.
type LayoutVersionInfo struct {
	Version      int    `json:"version"`
	Status       string `json:"status"`
	StorageNodes int    `json:"storageNodes"`
	GatewayNodes int    `json:"gatewayNodes"`
}

// LayoutHistory mirrors GetClusterLayoutHistory.
type LayoutHistory struct {
	CurrentVersion int                 `json:"currentVersion"`
	MinAck         int                 `json:"minAck"`
	Versions       []LayoutVersionInfo `json:"versions"`
	UpdateTrackers json.RawMessage     `json:"updateTrackers"`
}

// LayoutPreview mirrors PreviewClusterLayoutChanges / ApplyClusterLayout responses.
type LayoutPreview struct {
	Message   []string        `json:"message"`
	NewLayout json.RawMessage `json:"newLayout"`
}

// NodeRoleChange is one entry in the UpdateClusterLayout request array.
// To remove a node, set Remove=true. Otherwise Zone/Capacity/Tags must all be set
// (Capacity nil means a gateway node).
type NodeRoleChange struct {
	NodeID   string   `json:"nodeId"`
	Zone     string   `json:"zone,omitempty"`
	Capacity *int64   `json:"capacity"`
	Tags     []string `json:"tags,omitempty"`
	Remove   bool     `json:"remove,omitempty"`
}

// ConnectNodeResult is one entry of the ConnectClusterNodes response.
type ConnectNodeResult struct {
	Success bool    `json:"success"`
	Error   *string `json:"error"`
}

// GetClusterStatistics calls GET /v2/GetClusterStatistics.
func (c *Client) GetClusterStatistics() (*ClusterStatistics, error) {
	var out ClusterStatistics
	err := c.do(context.Background(), http.MethodGet, "/v2/GetClusterStatistics", nil, &out)
	return &out, err
}

// GetClusterLayout calls GET /v2/GetClusterLayout.
func (c *Client) GetClusterLayout() (*ClusterLayout, error) {
	var out ClusterLayout
	err := c.do(context.Background(), http.MethodGet, "/v2/GetClusterLayout", nil, &out)
	return &out, err
}

// GetClusterLayoutHistory calls GET /v2/GetClusterLayoutHistory.
func (c *Client) GetClusterLayoutHistory() (*LayoutHistory, error) {
	var out LayoutHistory
	err := c.do(context.Background(), http.MethodGet, "/v2/GetClusterLayoutHistory", nil, &out)
	return &out, err
}

// UpdateClusterLayout stages role changes. POST /v2/UpdateClusterLayout (array body).
func (c *Client) UpdateClusterLayout(changes []NodeRoleChange) (*ClusterLayout, error) {
	var out ClusterLayout
	err := c.do(context.Background(), http.MethodPost, "/v2/UpdateClusterLayout", changes, &out)
	return &out, err
}

// PreviewClusterLayoutChanges calls POST /v2/PreviewClusterLayoutChanges.
func (c *Client) PreviewClusterLayoutChanges() (*LayoutPreview, error) {
	var out LayoutPreview
	err := c.do(context.Background(), http.MethodPost, "/v2/PreviewClusterLayoutChanges", nil, &out)
	return &out, err
}

// ApplyClusterLayout applies staged changes for the given version.
func (c *Client) ApplyClusterLayout(version int) (*LayoutPreview, error) {
	var out LayoutPreview
	err := c.do(context.Background(), http.MethodPost, "/v2/ApplyClusterLayout", map[string]int{"version": version}, &out)
	return &out, err
}

// RevertClusterLayout discards staged changes. POST /v2/RevertClusterLayout.
func (c *Client) RevertClusterLayout() (*ClusterLayout, error) {
	var out ClusterLayout
	err := c.do(context.Background(), http.MethodPost, "/v2/RevertClusterLayout", map[string]any{}, &out)
	return &out, err
}

// ConnectClusterNodes calls POST /v2/ConnectClusterNodes with "id@addr" strings.
func (c *Client) ConnectClusterNodes(nodes []string) ([]ConnectNodeResult, error) {
	var out []ConnectNodeResult
	err := c.do(context.Background(), http.MethodPost, "/v2/ConnectClusterNodes", nodes, &out)
	return out, err
}
```

- [ ] **Step 4: Run `go test ./internal/garage/` — confirm PASS (all).**

- [ ] **Step 5: Commit**

```
git add src/internal/garage/cluster.go src/internal/garage/cluster_test.go
git commit -m "feat: add Garage client cluster statistics and layout operations"
```

---

## Task 2: API handlers — cluster statistics, layout, connect

**Files:** Create `src/internal/api/cluster_layout.go`, `src/internal/api/cluster_layout_test.go`; MODIFY `src/internal/api/cluster_status.go`.

- [ ] **Step 1: Modify `src/internal/api/cluster_status.go` — add sub-routes inside the existing `/cluster` group.**

Find the `mountCluster` method and replace its body's route block so it reads:
```go
func (s *Server) mountCluster(r chi.Router) {
	r.Route("/cluster", func(r chi.Router) {
		r.Use(s.Auth.RequireAuth)
		r.Get("/health", s.handleClusterHealth)
		r.Get("/status", s.handleClusterStatus)
		r.Get("/statistics", s.handleClusterStatistics)
		r.Get("/layout", s.handleGetLayout)
		r.Get("/layout/history", s.handleLayoutHistory)
		r.With(s.Auth.RequireAdmin).Post("/layout/stage", s.handleStageLayout)
		r.With(s.Auth.RequireAdmin).Post("/layout/preview", s.handlePreviewLayout)
		r.With(s.Auth.RequireAdmin).Post("/layout/apply", s.handleApplyLayout)
		r.With(s.Auth.RequireAdmin).Post("/layout/revert", s.handleRevertLayout)
		r.With(s.Auth.RequireAdmin).Post("/connect", s.handleConnectNodes)
	})
}
```
(Leave `handleClusterHealth`, `handleClusterStatus`, and `garageClientForRequest` exactly as they are — they stay in `cluster_status.go`.)

- [ ] **Step 2: Write `src/internal/api/cluster_layout_test.go`**

```go
package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestClusterStatisticsProxy(t *testing.T) {
	r, cookie := newGarageBackedAPI(t, "readonly", func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`{"freeform":"x","dataAvail":1,"metadataAvail":1,"incompleteAvailInfo":false,"bucketCount":2,"totalObjectCount":0,"totalObjectBytes":0}`))
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/api/cluster/statistics", nil)
	req.AddCookie(cookie)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "bucketCount") {
		t.Fatalf("code=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestGetLayoutProxy(t *testing.T) {
	r, cookie := newGarageBackedAPI(t, "readonly", func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`{"version":1,"roles":[],"parameters":{"zoneRedundancy":"maximum"},"partitionSize":1,"stagedRoleChanges":[],"stagedParameters":null}`))
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/api/cluster/layout", nil)
	req.AddCookie(cookie)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"version"`) {
		t.Fatalf("code=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestStageLayoutRequiresAdmin(t *testing.T) {
	r, cookie := newGarageBackedAPI(t, "readonly", func(w http.ResponseWriter, _ *http.Request) {})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/cluster/layout/stage", strings.NewReader(`{"changes":[]}`))
	req.AddCookie(cookie)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Errorf("code=%d want 403", rec.Code)
	}
}

func TestApplyLayoutProxiesVersion(t *testing.T) {
	var sawVersion bool
	r, cookie := newGarageBackedAPI(t, "admin", func(w http.ResponseWriter, req *http.Request) {
		if req.URL.Path == "/v2/ApplyClusterLayout" {
			b := make([]byte, 64)
			n, _ := req.Body.Read(b)
			sawVersion = strings.Contains(string(b[:n]), `"version"`)
		}
		w.Write([]byte(`{"message":["applied"]}`))
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/cluster/layout/apply", strings.NewReader(`{"version":3}`))
	req.AddCookie(cookie)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !sawVersion {
		t.Fatalf("code=%d sawVersion=%v", rec.Code, sawVersion)
	}
}

func TestConnectNodesProxy(t *testing.T) {
	var gotPath string
	r, cookie := newGarageBackedAPI(t, "admin", func(w http.ResponseWriter, req *http.Request) {
		gotPath = req.URL.Path
		w.Write([]byte(`[{"success":true,"error":null}]`))
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/cluster/connect", strings.NewReader(`{"nodes":["n1@1.2.3.4:3901"]}`))
	req.AddCookie(cookie)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || gotPath != "/v2/ConnectClusterNodes" {
		t.Fatalf("code=%d path=%q", rec.Code, gotPath)
	}
}
```

- [ ] **Step 3: Run `go test ./internal/api/ -run 'Layout|Statistics|Connect'` — confirm FAIL.**

- [ ] **Step 4: Write `src/internal/api/cluster_layout.go`**

```go
package api

import (
	"net/http"

	"github.com/HungHD/garage-admin/internal/garage"
)

func (s *Server) handleClusterStatistics(w http.ResponseWriter, r *http.Request) {
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	stats, err := client.GetClusterStatistics()
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, stats)
}

func (s *Server) handleGetLayout(w http.ResponseWriter, r *http.Request) {
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	layout, err := client.GetClusterLayout()
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, layout)
}

func (s *Server) handleLayoutHistory(w http.ResponseWriter, r *http.Request) {
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	hist, err := client.GetClusterLayoutHistory()
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, hist)
}

func (s *Server) handleStageLayout(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Changes []struct {
			NodeID   string   `json:"node_id"`
			Zone     string   `json:"zone"`
			Capacity *int64   `json:"capacity"`
			Tags     []string `json:"tags"`
			Remove   bool     `json:"remove"`
		} `json:"changes"`
	}
	if err := decodeJSON(r, &body); err != nil || len(body.Changes) == 0 {
		writeError(w, http.StatusBadRequest, "changes are required")
		return
	}
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	changes := make([]garage.NodeRoleChange, 0, len(body.Changes))
	for _, c := range body.Changes {
		tags := c.Tags
		if tags == nil {
			tags = []string{}
		}
		changes = append(changes, garage.NodeRoleChange{
			NodeID: c.NodeID, Zone: c.Zone, Capacity: c.Capacity, Tags: tags, Remove: c.Remove,
		})
	}
	layout, err := client.UpdateClusterLayout(changes)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, layout)
}

func (s *Server) handlePreviewLayout(w http.ResponseWriter, r *http.Request) {
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	prev, err := client.PreviewClusterLayoutChanges()
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, prev)
}

func (s *Server) handleApplyLayout(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Version int `json:"version"`
	}
	if err := decodeJSON(r, &body); err != nil || body.Version == 0 {
		writeError(w, http.StatusBadRequest, "version is required")
		return
	}
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	res, err := client.ApplyClusterLayout(body.Version)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (s *Server) handleRevertLayout(w http.ResponseWriter, r *http.Request) {
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	layout, err := client.RevertClusterLayout()
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, layout)
}

func (s *Server) handleConnectNodes(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Nodes []string `json:"nodes"`
	}
	if err := decodeJSON(r, &body); err != nil || len(body.Nodes) == 0 {
		writeError(w, http.StatusBadRequest, "nodes are required")
		return
	}
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	res, err := client.ConnectClusterNodes(body.Nodes)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, res)
}
```

- [ ] **Step 5: Run `go test ./...` (from src/) — confirm all PASS. Run `go vet ./...`.**

- [ ] **Step 6: Commit**

```
git add src/internal/api/cluster_layout.go src/internal/api/cluster_layout_test.go src/internal/api/cluster_status.go
git commit -m "feat: add cluster statistics and layout management API handlers"
```

---

## Task 3: Frontend — Cluster page (Overview + Layout)

**Files:** MODIFY `src/web/src/api/client.ts`; create `src/web/src/pages/ClusterPage.tsx`, `src/web/src/components/ClusterOverview.tsx`, `src/web/src/components/ClusterLayout.tsx`; MODIFY `src/web/src/components/AppShell.tsx`, `src/web/src/App.tsx`.

- [ ] **Step 1: Append cluster TS types to `src/web/src/api/client.ts`**

```ts
export interface ClusterNode {
  id: string
  hostname: string
  addr: string
  isUp: boolean
  draining: boolean
  lastSeenSecsAgo: number | null
  garageVersion: string
  role: { zone: string; capacity: number | null; tags: string[] } | null
  dataPartition: { available: number; total: number } | null
  metadataPartition: { available: number; total: number } | null
}

export interface ClusterStatus {
  layoutVersion: number
  nodes: ClusterNode[]
}

export interface ClusterStatistics {
  freeform: string
  dataAvail: number
  metadataAvail: number
  incompleteAvailInfo: boolean
  bucketCount: number
  totalObjectCount: number
  totalObjectBytes: number
}

export interface LayoutRole {
  id: string
  zone: string
  tags: string[]
  capacity: number | null
  storedPartitions: number
  usableCapacity: number | null
}

export interface StagedRoleChange {
  id: string
  remove: boolean
  zone: string
  capacity: number | null
  tags: string[]
}

export interface ClusterLayoutData {
  version: number
  roles: LayoutRole[]
  parameters: unknown
  partitionSize: number
  stagedRoleChanges: StagedRoleChange[]
  stagedParameters: unknown
}

export interface LayoutVersionInfo {
  version: number
  status: string
  storageNodes: number
  gatewayNodes: number
}

export interface LayoutHistory {
  currentVersion: number
  minAck: number
  versions: LayoutVersionInfo[]
}

export interface LayoutPreview {
  message: string[]
  newLayout: unknown
}
```

- [ ] **Step 2: Create `src/web/src/components/ClusterOverview.tsx`**

```tsx
import { Badge, Card, Grid, Group, Loader, Stack, Table, Text, Title } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { api, type ClusterStatus, type ClusterStatistics, type ClusterHealth } from '../api/client'
import { fmtBytes } from '../pages/BucketsPage'

export function ClusterOverview() {
  const health = useQuery({ queryKey: ['cluster-health'], queryFn: async () => (await api.get<ClusterHealth>('/cluster/health')).data })
  const stats = useQuery({ queryKey: ['cluster-stats'], queryFn: async () => (await api.get<ClusterStatistics>('/cluster/statistics')).data })
  const status = useQuery({ queryKey: ['cluster-status'], queryFn: async () => (await api.get<ClusterStatus>('/cluster/status')).data })

  if (health.isLoading || stats.isLoading || status.isLoading) return <Loader />
  if (health.error || stats.error || status.error) return <Text c="red">Không lấy được dữ liệu cluster. Kiểm tra Settings / kết nối.</Text>

  return (
    <Stack>
      <Group>
        <Text>Trạng thái:</Text>
        <Badge color={health.data!.status === 'healthy' ? 'green' : 'red'}>{health.data!.status}</Badge>
      </Group>
      <Grid>
        <Grid.Col span={{ base: 12, sm: 6, md: 3 }}><Card withBorder><Text size="sm" c="dimmed">Node kết nối</Text><Text fw={700} size="xl">{health.data!.connectedNodes}/{health.data!.knownNodes}</Text></Card></Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6, md: 3 }}><Card withBorder><Text size="sm" c="dimmed">Dung lượng trống (data)</Text><Text fw={700} size="xl">{fmtBytes(stats.data!.dataAvail)}</Text></Card></Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6, md: 3 }}><Card withBorder><Text size="sm" c="dimmed">Buckets</Text><Text fw={700} size="xl">{stats.data!.bucketCount}</Text></Card></Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6, md: 3 }}><Card withBorder><Text size="sm" c="dimmed">Objects</Text><Text fw={700} size="xl">{stats.data!.totalObjectCount}</Text></Card></Grid.Col>
      </Grid>

      <Card withBorder>
        <Title order={5} mb="sm">Nodes</Title>
        <Table>
          <Table.Thead>
            <Table.Tr><Table.Th>ID</Table.Th><Table.Th>Hostname</Table.Th><Table.Th>Zone</Table.Th><Table.Th>Capacity</Table.Th><Table.Th>Data avail</Table.Th><Table.Th>Trạng thái</Table.Th></Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {status.data!.nodes.map((n) => (
              <Table.Tr key={n.id}>
                <Table.Td><code>{n.id.slice(0, 16)}…</code></Table.Td>
                <Table.Td>{n.hostname}</Table.Td>
                <Table.Td>{n.role?.zone ?? '—'}</Table.Td>
                <Table.Td>{n.role?.capacity != null ? fmtBytes(n.role.capacity) : 'gateway'}</Table.Td>
                <Table.Td>{n.dataPartition ? `${fmtBytes(n.dataPartition.available)} / ${fmtBytes(n.dataPartition.total)}` : '—'}</Table.Td>
                <Table.Td>{n.isUp ? <Badge color="green">up</Badge> : <Badge color="red">down</Badge>}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>
    </Stack>
  )
}
```

- [ ] **Step 3: Create `src/web/src/components/ClusterLayout.tsx`**

```tsx
import { useState } from 'react'
import {
  Alert, Badge, Button, Card, Code, Group, Loader, Modal, NumberInput, Stack, Table, Text, TextInput, Textarea, Title,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type ClusterLayoutData, type LayoutHistory, type LayoutPreview, type ClusterStatus } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { fmtBytes } from '../pages/BucketsPage'

export function ClusterLayout() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const qc = useQueryClient()

  const layout = useQuery({ queryKey: ['cluster-layout'], queryFn: async () => (await api.get<ClusterLayoutData>('/cluster/layout')).data })
  const history = useQuery({ queryKey: ['cluster-layout-history'], queryFn: async () => (await api.get<LayoutHistory>('/cluster/layout/history')).data })
  const status = useQuery({ queryKey: ['cluster-status'], queryFn: async () => (await api.get<ClusterStatus>('/cluster/status')).data })

  const [preview, setPreview] = useState<LayoutPreview | null>(null)
  const [applyOpen, setApplyOpen] = useState(false)
  const [connectText, setConnectText] = useState('')

  // staging form
  const [nodeId, setNodeId] = useState('')
  const [zone, setZone] = useState('')
  const [capacity, setCapacity] = useState<number | ''>('')
  const [tags, setTags] = useState('')

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['cluster-layout'] })
    qc.invalidateQueries({ queryKey: ['cluster-layout-history'] })
    qc.invalidateQueries({ queryKey: ['cluster-status'] })
  }

  const stageMut = useMutation({
    mutationFn: async () => (await api.post('/cluster/layout/stage', {
      changes: [{
        node_id: nodeId, zone, capacity: capacity === '' ? null : Number(capacity),
        tags: tags ? tags.split(',').map((t) => t.trim()).filter(Boolean) : [], remove: false,
      }],
    })).data,
    onSuccess: () => { refresh(); notifications.show({ color: 'green', message: 'Đã stage thay đổi' }); setNodeId(''); setZone(''); setCapacity(''); setTags('') },
    onError: () => notifications.show({ color: 'red', message: 'Stage thất bại' }),
  })

  const previewMut = useMutation({
    mutationFn: async () => (await api.post<LayoutPreview>('/cluster/layout/preview', {})).data,
    onSuccess: (data) => setPreview(data),
    onError: () => notifications.show({ color: 'red', message: 'Preview thất bại' }),
  })

  const applyMut = useMutation({
    mutationFn: async (version: number) => (await api.post('/cluster/layout/apply', { version })).data,
    onSuccess: () => { refresh(); setApplyOpen(false); setPreview(null); notifications.show({ color: 'green', message: 'Đã apply layout' }) },
    onError: () => notifications.show({ color: 'red', message: 'Apply thất bại' }),
  })

  const revertMut = useMutation({
    mutationFn: async () => (await api.post('/cluster/layout/revert', {})).data,
    onSuccess: () => { refresh(); notifications.show({ color: 'green', message: 'Đã revert staged changes' }) },
    onError: () => notifications.show({ color: 'red', message: 'Revert thất bại' }),
  })

  const connectMut = useMutation({
    mutationFn: async () => (await api.post('/cluster/connect', { nodes: connectText.split('\n').map((l) => l.trim()).filter(Boolean) })).data,
    onSuccess: () => { refresh(); setConnectText(''); notifications.show({ color: 'green', message: 'Đã gửi yêu cầu kết nối' }) },
    onError: () => notifications.show({ color: 'red', message: 'Kết nối thất bại' }),
  })

  if (layout.isLoading || !layout.data) return <Loader />
  const l = layout.data
  const hasStaged = l.stagedRoleChanges.length > 0

  return (
    <Stack>
      <Card withBorder>
        <Group justify="space-between">
          <Title order={5}>Layout version {l.version}</Title>
          <Text size="sm" c="dimmed">Partition size: {fmtBytes(l.partitionSize)}</Text>
        </Group>
        <Table mt="sm">
          <Table.Thead>
            <Table.Tr><Table.Th>Node</Table.Th><Table.Th>Zone</Table.Th><Table.Th>Capacity</Table.Th><Table.Th>Partitions</Table.Th><Table.Th>Tags</Table.Th></Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {l.roles.map((role) => (
              <Table.Tr key={role.id}>
                <Table.Td><code>{role.id.slice(0, 16)}…</code></Table.Td>
                <Table.Td>{role.zone}</Table.Td>
                <Table.Td>{role.capacity != null ? fmtBytes(role.capacity) : 'gateway'}</Table.Td>
                <Table.Td>{role.storedPartitions}</Table.Td>
                <Table.Td>{role.tags.join(', ') || '—'}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>

      {hasStaged && (
        <Alert color="yellow" title="Có thay đổi đang chờ (staged)">
          <Stack gap="xs">
            {l.stagedRoleChanges.map((c) => (
              <Text key={c.id} size="sm">
                <code>{c.id.slice(0, 12)}…</code> — {c.remove ? 'REMOVE' : `zone=${c.zone}, capacity=${c.capacity != null ? fmtBytes(c.capacity) : 'gateway'}, tags=[${c.tags.join(', ')}]`}
              </Text>
            ))}
            {isAdmin && (
              <Group mt="xs">
                <Button variant="light" onClick={() => previewMut.mutate()} loading={previewMut.isPending}>Preview</Button>
                <Button color="green" onClick={() => setApplyOpen(true)}>Apply (v{l.version + 1})</Button>
                <Button color="red" variant="light" onClick={() => revertMut.mutate()} loading={revertMut.isPending}>Revert</Button>
              </Group>
            )}
          </Stack>
        </Alert>
      )}

      {isAdmin && (
        <Card withBorder>
          <Title order={5} mb="sm">Stage thay đổi role cho node</Title>
          <Text size="xs" c="dimmed" mb="xs">Đặt capacity (bytes) cho node lưu trữ, để trống = gateway. ID node lấy từ tab Overview.</Text>
          <Group align="end">
            <TextInput label="Node ID" value={nodeId} onChange={(e) => setNodeId(e.currentTarget.value)} w={260} />
            <TextInput label="Zone" value={zone} onChange={(e) => setZone(e.currentTarget.value)} w={120} />
            <NumberInput label="Capacity (bytes)" value={capacity} onChange={(v) => setCapacity(typeof v === 'number' ? v : '')} w={180} min={0} />
            <TextInput label="Tags (phẩy)" value={tags} onChange={(e) => setTags(e.currentTarget.value)} w={160} />
            <Button onClick={() => stageMut.mutate()} loading={stageMut.isPending} disabled={!nodeId || !zone}>Stage</Button>
          </Group>
        </Card>
      )}

      <Card withBorder>
        <Title order={5} mb="sm">Lịch sử layout</Title>
        <Table>
          <Table.Thead>
            <Table.Tr><Table.Th>Version</Table.Th><Table.Th>Trạng thái</Table.Th><Table.Th>Storage nodes</Table.Th><Table.Th>Gateway nodes</Table.Th></Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {history.data?.versions.map((v) => (
              <Table.Tr key={v.version}>
                <Table.Td>{v.version}</Table.Td>
                <Table.Td>{v.version === history.data!.currentVersion ? <Badge color="blue">{v.status}</Badge> : v.status}</Table.Td>
                <Table.Td>{v.storageNodes}</Table.Td>
                <Table.Td>{v.gatewayNodes}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>

      {isAdmin && (
        <Card withBorder>
          <Title order={5} mb="sm">Kết nối node</Title>
          <Text size="xs" c="dimmed" mb="xs">Mỗi dòng một node: <code>node_id@host:port</code></Text>
          <Textarea value={connectText} onChange={(e) => setConnectText(e.currentTarget.value)} minRows={2} autosize placeholder="abcdef123…@192.168.1.50:3901" />
          <Button mt="sm" variant="light" onClick={() => connectMut.mutate()} loading={connectMut.isPending} disabled={!connectText.trim()}>Kết nối</Button>
        </Card>
      )}

      <Modal opened={preview != null} onClose={() => setPreview(null)} title="Preview layout changes" size="lg">
        {preview && (
          <Code block>{preview.message.join('\n')}</Code>
        )}
      </Modal>

      <Modal opened={applyOpen} onClose={() => setApplyOpen(false)} title="Xác nhận apply layout">
        <Stack>
          <Alert color="orange">Apply sẽ ghi layout mới (version {l.version + 1}) và bắt đầu di chuyển dữ liệu. Hành động này khó hoàn tác.</Alert>
          <Button color="green" onClick={() => applyMut.mutate(l.version + 1)} loading={applyMut.isPending}>
            Apply version {l.version + 1}
          </Button>
        </Stack>
      </Modal>
    </Stack>
  )
}
```

- [ ] **Step 4: Create `src/web/src/pages/ClusterPage.tsx`**

```tsx
import { Stack, Tabs, Title } from '@mantine/core'
import { ClusterOverview } from '../components/ClusterOverview'
import { ClusterLayout } from '../components/ClusterLayout'

export function ClusterPage() {
  return (
    <Stack>
      <Title order={3}>Cluster</Title>
      <Tabs defaultValue="overview">
        <Tabs.List>
          <Tabs.Tab value="overview">Overview</Tabs.Tab>
          <Tabs.Tab value="layout">Layout</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="overview" pt="md"><ClusterOverview /></Tabs.Panel>
        <Tabs.Panel value="layout" pt="md"><ClusterLayout /></Tabs.Panel>
      </Tabs>
    </Stack>
  )
}
```

- [ ] **Step 5: Add the Cluster nav link in `src/web/src/components/AppShell.tsx`**

Add the icon import (extend the existing `@tabler/icons-react` import) with `IconServer`, and add a nav link after the "Access Keys" link and before "Settings":
```tsx
        <NavLink component={Link} to="/cluster" label="Cluster" active={loc.pathname.startsWith('/cluster')} leftSection={<IconServer size={18} />} />
```

- [ ] **Step 6: Add the route in `src/web/src/App.tsx`**

Add import `import { ClusterPage } from './pages/ClusterPage'` and a route inside the authenticated `<Routes>`:
```tsx
        <Route path="/cluster" element={<ClusterPage />} />
```

- [ ] **Step 7: Build the frontend and rebuild the binary**

```bash
cd /Users/hunghd/Repositories/garage-admin/src/web && npm run build
cd /Users/hunghd/Repositories/garage-admin/src && go build ./... && go test ./...
```
Fix any TS errors minimally (unused imports). Confirm dist rebuilt and all Go tests pass.

- [ ] **Step 8: Commit**

```
cd /Users/hunghd/Repositories/garage-admin
git add src/web/src src/internal/web/dist
git commit -m "feat: add Cluster page (overview + layout management)"
```

---

## Task 4: Verify end-to-end (controller)

The controller will start the binary, seed the real cluster, and use Playwright MCP to verify:
- Cluster → Overview: health badge, statistics cards, node table (the single node, zone dc1, capacity, up).
- Cluster → Layout: version 1, roles table, history (version 1 Current). No staged changes initially.
- Read-only paths only against the live cluster. Layout staging/apply/revert/connect are NOT exercised live (destructive on a real cluster) unless the user explicitly approves; the handlers are covered by unit tests.

No code changes expected; if the UI reveals a bug, fix it as a follow-up task.

---

## Self-Review

**Spec coverage (Phase 3 = "Quản lý Cluster" + layout from the design spec):**
- Cluster status / nodes, health, statistics → Tasks 1, 2, 3 (Overview). ✓
- Layout view (roles, params, partition size) + staged changes + history → Tasks 1, 2, 3 (Layout). ✓
- Layout workflow: stage (UpdateClusterLayout) → preview → apply (with version) → revert → Tasks 1, 2, 3. ✓
- Connect nodes → Tasks 1, 2, 3. ✓
- Reads = auth; mutations = admin (frontend hides + backend RequireAdmin) → Tasks 2, 3. ✓

**Placeholder scan:** No TBD/TODO; all code complete.

**Type consistency:** `garage` structs (`ClusterStatistics`, `ClusterLayout`, `LayoutRole`, `StagedRoleChange`, `LayoutHistory`, `LayoutPreview`, `NodeRoleChange`, `ConnectNodeResult`) used consistently across `garage` and `api`. API request bodies use snake_case (`node_id`, `version`, `nodes`); the `/api/cluster/*` GET responses pass Garage's camelCase JSON through, so the frontend TS interfaces use camelCase (consistent with the buckets/keys passthrough convention from Phase 2). `fmtBytes` is reused from `BucketsPage`.

**Safety:** Apply requires an explicit confirmation modal and sends the mandatory `version` (current+1). Preview is available before apply. Revert discards staged changes. These mutations are admin-only and not auto-exercised against the live cluster.
