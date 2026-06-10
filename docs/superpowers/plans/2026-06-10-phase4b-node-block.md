# Phase 4b — Node / Worker / Block Maintenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A per-node maintenance area: inspect node info & statistics, list/inspect/tune background workers, run maintenance (metadata snapshot, repair operations), and manage data blocks (list errors, inspect a block, retry resync, purge). All node-scoped calls target a chosen node via `?node=<id>` (or `self`/`*`).

**Architecture:** Extend the Garage client (`internal/garage/node.go`) with the node/worker/block operations using the verified multi-node envelope `{success:{nodeId:T}, error:{nodeId:msg}}`; client methods return `json.RawMessage` (raw envelope) for thin passthrough. Add `internal/api` handlers under `/api/nodes/*` (reads: auth; mutations: admin-only). Add a React `NodeMaintenancePage` with a node selector. Read paths verified live; destructive mutations (repair, retry, purge) are gated by confirmation modals and covered by mock tests — not auto-exercised on the live cluster.

**Tech stack:** Same as prior phases. No new dependencies.

**Branch:** `phase4-node-block-tokens` (continues after Phase 4a). Module root `src/`; run `go` from `src/`.

**Verified contracts (Garage v2.3.0 source + live):**
- Envelope: `{ "success": { "<nodeId>": <T> }, "error": { "<nodeId>": "<msg>" } }`. Node selector query param `?node=` accepts a node id, `*` (all), or `self`.
- `GET /v2/GetNodeInfo?node=` → success[nodeId] = `{nodeId, hostname, garageVersion, garageFeatures[], rustVersion, dbEngine}`
- `GET /v2/GetNodeStatistics?node=` → success[nodeId] = `{freeform}`
- `POST /v2/ListWorkers?node=` body `{busyOnly:bool, errorOnly:bool}` → success[nodeId] = `[{id, name, state, errors, consecutiveErrors, lastError, tranquility, progress, queueLength, persistentErrors, freeform}]`
- `POST /v2/GetWorkerInfo?node=` body `{id:number}`
- `POST /v2/GetWorkerVariable?node=` body `{variable:string|null}`
- `POST /v2/SetWorkerVariable?node=` body `{variable:string, value:string}`
- `POST /v2/CreateMetadataSnapshot?node=` (no body)
- `POST /v2/LaunchRepairOperation?node=` body `{repairType:"tables"|"blocks"|"versions"|"multipartUploads"|"blockRefs"|"blockRc"|"rebalance"|"aliases"|"clearResyncQueue"}`
- `GET /v2/ListBlockErrors?node=` → success[nodeId] = `[...]`
- `POST /v2/GetBlockInfo?node=` body `{blockHash:string}`
- `POST /v2/RetryBlockResync?node=` body `{all:true}` OR `{blockHashes:[string]}`
- `POST /v2/PurgeBlocks?node=` body `["<hash>", ...]` (bare array)

---

## File Structure

```
src/internal/garage/node.go            # NEW client methods (+ node_test.go)
src/internal/api/nodes.go              # NEW handlers /api/nodes/* (+ nodes_test.go)
src/internal/api/server.go             # MODIFY: mount nodes
src/web/src/api/client.ts              # MODIFY: add node/worker types + MultiNode<T>
src/web/src/pages/NodeMaintenancePage.tsx   # NEW
src/web/src/components/AppShell.tsx     # MODIFY: nav link
src/web/src/App.tsx                     # MODIFY: route
```

---

## Task 1: Garage client — node/worker/block operations

**Files:** Create `src/internal/garage/node.go`, `src/internal/garage/node_test.go`

- [ ] **Step 1: Write `src/internal/garage/node_test.go`**

```go
package garage

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNodeReadEndpoints(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("node") != "self" {
			t.Errorf("node=%q", r.URL.Query().Get("node"))
		}
		w.Write([]byte(`{"success":{"n1":{"ok":true}},"error":{}}`))
	}))
	defer srv.Close()
	c := New(srv.URL, "t")
	for _, call := range []func() (json.RawMessage, error){
		func() (json.RawMessage, error) { return c.GetNodeInfo("self") },
		func() (json.RawMessage, error) { return c.GetNodeStatistics("self") },
		func() (json.RawMessage, error) { return c.ListBlockErrors("self") },
	} {
		raw, err := call()
		if err != nil {
			t.Fatal(err)
		}
		if len(raw) == 0 {
			t.Error("empty raw response")
		}
	}
}

func TestListWorkersSendsFlags(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v2/ListWorkers" || r.Method != http.MethodPost {
			t.Errorf("path=%q method=%q", r.URL.Path, r.Method)
		}
		var body map[string]bool
		b, _ := io.ReadAll(r.Body)
		json.Unmarshal(b, &body)
		if !body["busyOnly"] || body["errorOnly"] {
			t.Errorf("flags=%v", body)
		}
		w.Write([]byte(`{"success":{"n1":[]},"error":{}}`))
	}))
	defer srv.Close()
	if _, err := New(srv.URL, "t").ListWorkers("self", true, false); err != nil {
		t.Fatal(err)
	}
}

func TestSetWorkerVariableBody(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]string
		b, _ := io.ReadAll(r.Body)
		json.Unmarshal(b, &body)
		if body["variable"] != "resync-tranquility" || body["value"] != "2" {
			t.Errorf("body=%v", body)
		}
		w.Write([]byte(`{"success":{"n1":null},"error":{}}`))
	}))
	defer srv.Close()
	if _, err := New(srv.URL, "t").SetWorkerVariable("self", "resync-tranquility", "2"); err != nil {
		t.Fatal(err)
	}
}

func TestRepairBody(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]string
		b, _ := io.ReadAll(r.Body)
		json.Unmarshal(b, &body)
		if body["repairType"] != "blocks" {
			t.Errorf("body=%v", body)
		}
		w.Write([]byte(`{"success":{"n1":null},"error":{}}`))
	}))
	defer srv.Close()
	if _, err := New(srv.URL, "t").LaunchRepairOperation("self", "blocks"); err != nil {
		t.Fatal(err)
	}
}

func TestRetryBlockResyncAllVsHashes(t *testing.T) {
	var bodies []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		bodies = append(bodies, string(b))
		w.Write([]byte(`{"success":{"n1":null},"error":{}}`))
	}))
	defer srv.Close()
	c := New(srv.URL, "t")
	if _, err := c.RetryBlockResync("self", true, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := c.RetryBlockResync("self", false, []string{"ab", "cd"}); err != nil {
		t.Fatal(err)
	}
	if bodies[0] != `{"all":true}` {
		t.Errorf("all body=%s", bodies[0])
	}
	if bodies[1] != `{"blockHashes":["ab","cd"]}` {
		t.Errorf("hashes body=%s", bodies[1])
	}
}

func TestPurgeBlocksSendsBareArray(t *testing.T) {
	var body string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		body = string(b)
		w.Write([]byte(`{"success":{"n1":null},"error":{}}`))
	}))
	defer srv.Close()
	if _, err := New(srv.URL, "t").PurgeBlocks("self", []string{"ab", "cd"}); err != nil {
		t.Fatal(err)
	}
	if body != `["ab","cd"]` {
		t.Errorf("purge body=%s", body)
	}
}

func TestGetBlockInfoBody(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]string
		b, _ := io.ReadAll(r.Body)
		json.Unmarshal(b, &body)
		if body["blockHash"] != "deadbeef" {
			t.Errorf("body=%v", body)
		}
		w.Write([]byte(`{"success":{"n1":{}},"error":{}}`))
	}))
	defer srv.Close()
	if _, err := New(srv.URL, "t").GetBlockInfo("self", "deadbeef"); err != nil {
		t.Fatal(err)
	}
}
```

- [ ] **Step 2: Run `go test ./internal/garage/ -run 'Node|Worker|Repair|Block|Purge'` — confirm FAIL.**

- [ ] **Step 3: Write `src/internal/garage/node.go`**

```go
package garage

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
)

// nodeRaw performs a node-scoped request (?node=) and returns the raw multi-node
// envelope JSON ({"success":{nodeId:...},"error":{nodeId:msg}}) for passthrough.
func (c *Client) nodeRaw(method, op, node string, body any) (json.RawMessage, error) {
	var out json.RawMessage
	path := "/v2/" + op + "?node=" + url.QueryEscape(node)
	err := c.do(context.Background(), method, path, body, &out)
	return out, err
}

// GetNodeInfo: GET /v2/GetNodeInfo?node=
func (c *Client) GetNodeInfo(node string) (json.RawMessage, error) {
	return c.nodeRaw(http.MethodGet, "GetNodeInfo", node, nil)
}

// GetNodeStatistics: GET /v2/GetNodeStatistics?node=
func (c *Client) GetNodeStatistics(node string) (json.RawMessage, error) {
	return c.nodeRaw(http.MethodGet, "GetNodeStatistics", node, nil)
}

// ListWorkers: POST /v2/ListWorkers?node= {busyOnly,errorOnly}
func (c *Client) ListWorkers(node string, busyOnly, errorOnly bool) (json.RawMessage, error) {
	return c.nodeRaw(http.MethodPost, "ListWorkers", node,
		map[string]bool{"busyOnly": busyOnly, "errorOnly": errorOnly})
}

// GetWorkerInfo: POST /v2/GetWorkerInfo?node= {id}
func (c *Client) GetWorkerInfo(node string, id uint64) (json.RawMessage, error) {
	return c.nodeRaw(http.MethodPost, "GetWorkerInfo", node, map[string]uint64{"id": id})
}

// GetWorkerVariable: POST /v2/GetWorkerVariable?node= {variable}
// An empty variable is sent as null (Garage returns all variables).
func (c *Client) GetWorkerVariable(node, variable string) (json.RawMessage, error) {
	var v *string
	if variable != "" {
		v = &variable
	}
	return c.nodeRaw(http.MethodPost, "GetWorkerVariable", node, map[string]*string{"variable": v})
}

// SetWorkerVariable: POST /v2/SetWorkerVariable?node= {variable,value}
func (c *Client) SetWorkerVariable(node, variable, value string) (json.RawMessage, error) {
	return c.nodeRaw(http.MethodPost, "SetWorkerVariable", node,
		map[string]string{"variable": variable, "value": value})
}

// CreateMetadataSnapshot: POST /v2/CreateMetadataSnapshot?node= (no body)
func (c *Client) CreateMetadataSnapshot(node string) (json.RawMessage, error) {
	return c.nodeRaw(http.MethodPost, "CreateMetadataSnapshot", node, nil)
}

// LaunchRepairOperation: POST /v2/LaunchRepairOperation?node= {repairType}
func (c *Client) LaunchRepairOperation(node, repairType string) (json.RawMessage, error) {
	return c.nodeRaw(http.MethodPost, "LaunchRepairOperation", node,
		map[string]string{"repairType": repairType})
}

// ListBlockErrors: GET /v2/ListBlockErrors?node=
func (c *Client) ListBlockErrors(node string) (json.RawMessage, error) {
	return c.nodeRaw(http.MethodGet, "ListBlockErrors", node, nil)
}

// GetBlockInfo: POST /v2/GetBlockInfo?node= {blockHash}
func (c *Client) GetBlockInfo(node, blockHash string) (json.RawMessage, error) {
	return c.nodeRaw(http.MethodPost, "GetBlockInfo", node, map[string]string{"blockHash": blockHash})
}

// RetryBlockResync: POST /v2/RetryBlockResync?node= — body is {all:true} OR {blockHashes:[...]}.
func (c *Client) RetryBlockResync(node string, all bool, blockHashes []string) (json.RawMessage, error) {
	var body any
	if all {
		body = map[string]bool{"all": true}
	} else {
		body = map[string][]string{"blockHashes": blockHashes}
	}
	return c.nodeRaw(http.MethodPost, "RetryBlockResync", node, body)
}

// PurgeBlocks: POST /v2/PurgeBlocks?node= — body is a bare array of block hashes.
func (c *Client) PurgeBlocks(node string, blockHashes []string) (json.RawMessage, error) {
	return c.nodeRaw(http.MethodPost, "PurgeBlocks", node, blockHashes)
}
```

- [ ] **Step 4: Run `go test ./internal/garage/` — confirm PASS (all).**

- [ ] **Step 5: Commit**

```
git add src/internal/garage/node.go src/internal/garage/node_test.go
git commit -m "feat: add Garage client node/worker/block operations"
```

---

## Task 2: API handlers — nodes/workers/blocks

**Files:** Create `src/internal/api/nodes.go`, `src/internal/api/nodes_test.go`; MODIFY `src/internal/api/server.go`.

The node target comes from `?node=` on the API request and is forwarded to Garage. If absent, default to `self`.

- [ ] **Step 1: Modify `src/internal/api/server.go` — add `s.mountNodes(r)` after `s.mountAdminTokens(r)`.**

- [ ] **Step 2: Write `src/internal/api/nodes_test.go`**

```go
package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestNodeInfoProxy(t *testing.T) {
	r, cookie := newGarageBackedAPI(t, "readonly", func(w http.ResponseWriter, req *http.Request) {
		if req.URL.Path != "/v2/GetNodeInfo" || req.URL.Query().Get("node") != "self" {
			t.Errorf("path=%q node=%q", req.URL.Path, req.URL.Query().Get("node"))
		}
		w.Write([]byte(`{"success":{"n1":{"hostname":"h"}},"error":{}}`))
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/api/nodes/info?node=self", nil)
	req.AddCookie(cookie)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "hostname") {
		t.Fatalf("code=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestListWorkersDefaultsNodeSelf(t *testing.T) {
	r, cookie := newGarageBackedAPI(t, "readonly", func(w http.ResponseWriter, req *http.Request) {
		if req.URL.Query().Get("node") != "self" {
			t.Errorf("node=%q want self", req.URL.Query().Get("node"))
		}
		w.Write([]byte(`{"success":{"n1":[]},"error":{}}`))
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/api/nodes/workers", nil) // no node param → default self
	req.AddCookie(cookie)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("code=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestRepairRequiresAdmin(t *testing.T) {
	r, cookie := newGarageBackedAPI(t, "readonly", func(w http.ResponseWriter, _ *http.Request) {})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/nodes/repair?node=self", strings.NewReader(`{"repair_type":"blocks"}`))
	req.AddCookie(cookie)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Errorf("code=%d want 403", rec.Code)
	}
}

func TestPurgeRequiresAdminAndProxies(t *testing.T) {
	var gotPath, gotBody string
	r, cookie := newGarageBackedAPI(t, "admin", func(w http.ResponseWriter, req *http.Request) {
		gotPath = req.URL.Path
		b := make([]byte, req.ContentLength)
		req.Body.Read(b)
		gotBody = string(b)
		w.Write([]byte(`{"success":{},"error":{}}`))
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/nodes/blocks/purge?node=self", strings.NewReader(`{"block_hashes":["ab","cd"]}`))
	req.AddCookie(cookie)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || gotPath != "/v2/PurgeBlocks" {
		t.Fatalf("code=%d path=%q", rec.Code, gotPath)
	}
	if gotBody != `["ab","cd"]` {
		t.Errorf("purge forwarded body=%s want bare array", gotBody)
	}
}
```

- [ ] **Step 3: Run `go test ./internal/api/ -run 'Node|Worker|Repair|Purge'` — confirm FAIL.**

- [ ] **Step 4: Write `src/internal/api/nodes.go`**

```go
package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

// nodeParam returns the ?node= value, defaulting to "self".
func nodeParam(r *http.Request) string {
	n := r.URL.Query().Get("node")
	if n == "" {
		return "self"
	}
	return n
}

func (s *Server) mountNodes(r chi.Router) {
	r.Route("/nodes", func(r chi.Router) {
		r.Use(s.Auth.RequireAuth)
		// reads
		r.Get("/info", s.handleNodeInfo)
		r.Get("/statistics", s.handleNodeStatistics)
		r.Get("/workers", s.handleListWorkers)
		r.Post("/workers/info", s.handleWorkerInfo)
		r.Get("/workers/variable", s.handleGetWorkerVariable)
		r.Get("/blocks/errors", s.handleListBlockErrors)
		r.Post("/blocks/info", s.handleGetBlockInfo)
		// mutations (admin)
		r.With(s.Auth.RequireAdmin).Post("/workers/variable", s.handleSetWorkerVariable)
		r.With(s.Auth.RequireAdmin).Post("/snapshot", s.handleMetadataSnapshot)
		r.With(s.Auth.RequireAdmin).Post("/repair", s.handleRepair)
		r.With(s.Auth.RequireAdmin).Post("/blocks/retry", s.handleRetryBlocks)
		r.With(s.Auth.RequireAdmin).Post("/blocks/purge", s.handlePurgeBlocks)
	})
}

// writeRaw emits a json.RawMessage from a garage passthrough call.
func (s *Server) writeRaw(w http.ResponseWriter, raw []byte, err error) {
	if err != nil {
		writeGarageError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write(raw)
}

func (s *Server) handleNodeInfo(w http.ResponseWriter, r *http.Request) {
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	raw, err := client.GetNodeInfo(nodeParam(r))
	s.writeRaw(w, raw, err)
}

func (s *Server) handleNodeStatistics(w http.ResponseWriter, r *http.Request) {
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	raw, err := client.GetNodeStatistics(nodeParam(r))
	s.writeRaw(w, raw, err)
}

func (s *Server) handleListWorkers(w http.ResponseWriter, r *http.Request) {
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	busy := r.URL.Query().Get("busy") == "1"
	errOnly := r.URL.Query().Get("error") == "1"
	raw, err := client.ListWorkers(nodeParam(r), busy, errOnly)
	s.writeRaw(w, raw, err)
}

func (s *Server) handleWorkerInfo(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ID uint64 `json:"id"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "id is required")
		return
	}
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	raw, err := client.GetWorkerInfo(nodeParam(r), body.ID)
	s.writeRaw(w, raw, err)
}

func (s *Server) handleGetWorkerVariable(w http.ResponseWriter, r *http.Request) {
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	raw, err := client.GetWorkerVariable(nodeParam(r), r.URL.Query().Get("variable"))
	s.writeRaw(w, raw, err)
}

func (s *Server) handleSetWorkerVariable(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Variable string `json:"variable"`
		Value    string `json:"value"`
	}
	if err := decodeJSON(r, &body); err != nil || body.Variable == "" {
		writeError(w, http.StatusBadRequest, "variable and value are required")
		return
	}
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	raw, err := client.SetWorkerVariable(nodeParam(r), body.Variable, body.Value)
	s.writeRaw(w, raw, err)
}

func (s *Server) handleMetadataSnapshot(w http.ResponseWriter, r *http.Request) {
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	raw, err := client.CreateMetadataSnapshot(nodeParam(r))
	s.writeRaw(w, raw, err)
}

func (s *Server) handleRepair(w http.ResponseWriter, r *http.Request) {
	var body struct {
		RepairType string `json:"repair_type"`
	}
	if err := decodeJSON(r, &body); err != nil || body.RepairType == "" {
		writeError(w, http.StatusBadRequest, "repair_type is required")
		return
	}
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	raw, err := client.LaunchRepairOperation(nodeParam(r), body.RepairType)
	s.writeRaw(w, raw, err)
}

func (s *Server) handleListBlockErrors(w http.ResponseWriter, r *http.Request) {
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	raw, err := client.ListBlockErrors(nodeParam(r))
	s.writeRaw(w, raw, err)
}

func (s *Server) handleGetBlockInfo(w http.ResponseWriter, r *http.Request) {
	var body struct {
		BlockHash string `json:"block_hash"`
	}
	if err := decodeJSON(r, &body); err != nil || body.BlockHash == "" {
		writeError(w, http.StatusBadRequest, "block_hash is required")
		return
	}
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	raw, err := client.GetBlockInfo(nodeParam(r), body.BlockHash)
	s.writeRaw(w, raw, err)
}

func (s *Server) handleRetryBlocks(w http.ResponseWriter, r *http.Request) {
	var body struct {
		All         bool     `json:"all"`
		BlockHashes []string `json:"block_hashes"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	raw, err := client.RetryBlockResync(nodeParam(r), body.All, body.BlockHashes)
	s.writeRaw(w, raw, err)
}

func (s *Server) handlePurgeBlocks(w http.ResponseWriter, r *http.Request) {
	var body struct {
		BlockHashes []string `json:"block_hashes"`
	}
	if err := decodeJSON(r, &body); err != nil || len(body.BlockHashes) == 0 {
		writeError(w, http.StatusBadRequest, "block_hashes are required")
		return
	}
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	raw, err := client.PurgeBlocks(nodeParam(r), body.BlockHashes)
	s.writeRaw(w, raw, err)
}
```

- [ ] **Step 5: Run `go test ./...` (from src/) — confirm all PASS. `go vet ./...`.**

- [ ] **Step 6: Commit**

```
git add src/internal/api/nodes.go src/internal/api/nodes_test.go src/internal/api/server.go
git commit -m "feat: add node/worker/block maintenance API handlers"
```

---

## Task 3: Frontend — Node Maintenance page

**Files:** MODIFY `src/web/src/api/client.ts`; create `src/web/src/pages/NodeMaintenancePage.tsx`; MODIFY `src/web/src/components/AppShell.tsx`, `src/web/src/App.tsx`.

- [ ] **Step 1: Append types to `src/web/src/api/client.ts`**

```ts
export interface MultiNode<T> {
  success: Record<string, T>
  error: Record<string, string>
}

export interface NodeInfoData {
  nodeId: string
  hostname: string
  garageVersion: string
  garageFeatures: string[]
  rustVersion: string
  dbEngine: string
}

export interface Worker {
  id: number
  name: string
  state: string
  errors: number
  consecutiveErrors: number
  lastError: unknown
  tranquility: number | null
  progress: string | null
  queueLength: number
  persistentErrors: unknown
  freeform: string[]
}

// firstNode returns the value for the chosen node id, or the first success entry.
export function firstNode<T>(resp: MultiNode<T> | undefined, nodeId?: string): T | undefined {
  if (!resp) return undefined
  if (nodeId && resp.success[nodeId]) return resp.success[nodeId]
  const keys = Object.keys(resp.success || {})
  return keys.length ? resp.success[keys[0]] : undefined
}
```

- [ ] **Step 2: Create `src/web/src/pages/NodeMaintenancePage.tsx`**

```tsx
import { useEffect, useState } from 'react'
import {
  Alert, Badge, Button, Card, Code, Group, Loader, Modal, Select, Stack, Table, Text, TextInput, Textarea, Title,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, firstNode, type ClusterStatus, type MultiNode, type NodeInfoData, type Worker } from '../api/client'
import { useAuth } from '../auth/AuthContext'

const REPAIR_TYPES = ['tables', 'blocks', 'versions', 'multipartUploads', 'blockRefs', 'blockRc', 'rebalance', 'aliases', 'clearResyncQueue']

export function NodeMaintenancePage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const qc = useQueryClient()
  const [node, setNode] = useState<string>('')

  const status = useQuery({ queryKey: ['cluster-status'], queryFn: async () => (await api.get<ClusterStatus>('/cluster/status')).data })

  useEffect(() => {
    if (!node && status.data?.nodes?.length) setNode(status.data.nodes[0].id)
  }, [status.data, node])

  const info = useQuery({
    queryKey: ['node-info', node],
    queryFn: async () => (await api.get<MultiNode<NodeInfoData>>('/nodes/info', { params: { node } })).data,
    enabled: !!node,
  })
  const stats = useQuery({
    queryKey: ['node-stats', node],
    queryFn: async () => (await api.get<MultiNode<{ freeform: string }>>('/nodes/statistics', { params: { node } })).data,
    enabled: !!node,
  })
  const workers = useQuery({
    queryKey: ['node-workers', node],
    queryFn: async () => (await api.get<MultiNode<Worker[]>>('/nodes/workers', { params: { node } })).data,
    enabled: !!node,
  })
  const blockErrors = useQuery({
    queryKey: ['node-block-errors', node],
    queryFn: async () => (await api.get<MultiNode<unknown[]>>('/nodes/blocks/errors', { params: { node } })).data,
    enabled: !!node,
  })

  const [repairType, setRepairType] = useState<string | null>('blocks')
  const [wvar, setWvar] = useState('')
  const [wval, setWval] = useState('')
  const [purgeText, setPurgeText] = useState('')
  const [confirm, setConfirm] = useState<null | { title: string; run: () => void }>(null)

  const mutate = (fn: () => Promise<unknown>, ok: string) =>
    fn().then(() => {
      notifications.show({ color: 'green', message: ok })
      qc.invalidateQueries({ queryKey: ['node-workers', node] })
      qc.invalidateQueries({ queryKey: ['node-block-errors', node] })
    }).catch((e: any) => notifications.show({ color: 'red', message: e?.response?.data?.error || 'Thao tác thất bại' }))

  if (status.isLoading) return <Loader />
  const nodeOptions = (status.data?.nodes ?? []).map((n) => ({ value: n.id, label: `${n.hostname} (${n.id.slice(0, 12)}…)` }))
  const nodeInfo = firstNode(info.data, node)
  const workerList = firstNode(workers.data, node) ?? []
  const errList = firstNode(blockErrors.data, node) ?? []

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={3}>Node Maintenance</Title>
        <Select w={320} data={nodeOptions} value={node || null} onChange={(v) => v && setNode(v)} allowDeselect={false} />
      </Group>

      <Card withBorder>
        <Title order={5} mb="sm">Thông tin node</Title>
        {nodeInfo ? (
          <Stack gap={4}>
            <Group><Text w={160} c="dimmed">Hostname</Text><Text>{nodeInfo.hostname}</Text></Group>
            <Group><Text w={160} c="dimmed">Garage version</Text><Badge>{nodeInfo.garageVersion}</Badge></Group>
            <Group><Text w={160} c="dimmed">DB engine</Text><Text>{nodeInfo.dbEngine}</Text></Group>
            <Group><Text w={160} c="dimmed">Rust</Text><Text>{nodeInfo.rustVersion}</Text></Group>
            <Group align="start"><Text w={160} c="dimmed">Features</Text><Group gap={4}>{nodeInfo.garageFeatures.map((f) => <Badge key={f} variant="light" size="sm">{f}</Badge>)}</Group></Group>
          </Stack>
        ) : <Loader size="sm" />}
      </Card>

      <Card withBorder>
        <Title order={5} mb="sm">Thống kê</Title>
        <Code block>{firstNode(stats.data, node)?.freeform ?? '…'}</Code>
      </Card>

      <Card withBorder>
        <Title order={5} mb="sm">Workers ({workerList.length})</Title>
        <Table>
          <Table.Thead>
            <Table.Tr><Table.Th>ID</Table.Th><Table.Th>Tên</Table.Th><Table.Th>Trạng thái</Table.Th><Table.Th>Lỗi</Table.Th><Table.Th>Queue</Table.Th><Table.Th>Tranquility</Table.Th></Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {workerList.map((wk) => (
              <Table.Tr key={wk.id}>
                <Table.Td>{wk.id}</Table.Td>
                <Table.Td>{wk.name}</Table.Td>
                <Table.Td><Badge variant="light" color={wk.state === 'busy' ? 'blue' : wk.errors > 0 ? 'red' : 'gray'}>{wk.state}</Badge></Table.Td>
                <Table.Td>{wk.errors}</Table.Td>
                <Table.Td>{wk.queueLength}</Table.Td>
                <Table.Td>{wk.tranquility ?? '—'}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>

      {isAdmin && (
        <Card withBorder>
          <Title order={5} mb="sm">Tinh chỉnh worker</Title>
          <Text size="xs" c="dimmed" mb="xs">Ví dụ: <code>resync-tranquility</code> = <code>2</code>, <code>resync-worker-count</code> = <code>4</code></Text>
          <Group align="end">
            <TextInput label="Variable" value={wvar} onChange={(e) => setWvar(e.currentTarget.value)} w={240} />
            <TextInput label="Value" value={wval} onChange={(e) => setWval(e.currentTarget.value)} w={140} />
            <Button onClick={() => mutate(() => api.post('/nodes/workers/variable', { variable: wvar, value: wval }, { params: { node } }), 'Đã set worker variable')} disabled={!wvar}>Set</Button>
          </Group>
        </Card>
      )}

      {isAdmin && (
        <Card withBorder>
          <Title order={5} mb="sm">Bảo trì</Title>
          <Group align="end">
            <Button variant="light" onClick={() => setConfirm({ title: 'Tạo metadata snapshot trên node này?', run: () => mutate(() => api.post('/nodes/snapshot', {}, { params: { node } }), 'Đã tạo snapshot') })}>Metadata snapshot</Button>
            <Select label="Repair type" data={REPAIR_TYPES} value={repairType} onChange={setRepairType} w={200} />
            <Button color="orange" onClick={() => setConfirm({ title: `Chạy repair "${repairType}" trên node này?`, run: () => mutate(() => api.post('/nodes/repair', { repair_type: repairType }, { params: { node } }), 'Đã khởi chạy repair') })} disabled={!repairType}>Launch repair</Button>
          </Group>
        </Card>
      )}

      <Card withBorder>
        <Group justify="space-between" mb="sm">
          <Title order={5}>Block errors ({errList.length})</Title>
          {isAdmin && errList.length > 0 && (
            <Button size="xs" variant="light" onClick={() => setConfirm({ title: 'Retry resync tất cả block lỗi?', run: () => mutate(() => api.post('/nodes/blocks/retry', { all: true }, { params: { node } }), 'Đã yêu cầu retry resync') })}>Retry tất cả</Button>
          )}
        </Group>
        {errList.length === 0 ? <Text size="sm" c="dimmed">Không có block lỗi.</Text> : <Code block>{JSON.stringify(errList, null, 2)}</Code>}
        {isAdmin && (
          <Stack mt="md">
            <Text size="sm" fw={600}>Purge blocks (nguy hiểm)</Text>
            <Text size="xs" c="dimmed">Mỗi dòng một block hash. Purge xóa vĩnh viễn mọi object tham chiếu các block này.</Text>
            <Textarea value={purgeText} onChange={(e) => setPurgeText(e.currentTarget.value)} minRows={2} autosize placeholder="hash..." />
            <Button color="red" w={160} disabled={!purgeText.trim()}
              onClick={() => setConfirm({
                title: 'XÓA VĨNH VIỄN các block đã nhập? Không thể hoàn tác.',
                run: () => mutate(() => api.post('/nodes/blocks/purge', { block_hashes: purgeText.split('\n').map((l) => l.trim()).filter(Boolean) }, { params: { node } }), 'Đã purge blocks'),
              })}>
              Purge
            </Button>
          </Stack>
        )}
      </Card>

      <Modal opened={confirm != null} onClose={() => setConfirm(null)} title="Xác nhận">
        <Stack>
          <Alert color="orange">{confirm?.title}</Alert>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirm(null)}>Hủy</Button>
            <Button color="red" onClick={() => { confirm?.run(); setConfirm(null) }}>Xác nhận</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  )
}
```

- [ ] **Step 3: Add nav link in `src/web/src/components/AppShell.tsx`**

Add `IconTool` to the `@tabler/icons-react` import and a nav link after "Admin Tokens" and before "Settings":
```tsx
        <NavLink component={Link} to="/nodes" label="Node Maintenance" active={loc.pathname.startsWith('/nodes')} leftSection={<IconTool size={18} />} />
```

- [ ] **Step 4: Add route in `src/web/src/App.tsx`**

Add `import { NodeMaintenancePage } from './pages/NodeMaintenancePage'` and a route:
```tsx
        <Route path="/nodes" element={<NodeMaintenancePage />} />
```

- [ ] **Step 5: Build + rebuild binary**

```bash
cd /Users/hunghd/Repositories/garage-admin/src/web && npm run build
cd /Users/hunghd/Repositories/garage-admin/src && go build ./... && go test ./...
```
Fix any TS errors minimally (e.g. if `IconTool` is missing in the installed icon set, substitute a present one such as `IconSettings2` or `IconTools`). Confirm dist rebuilt.

- [ ] **Step 6: Commit**

```
cd /Users/hunghd/Repositories/garage-admin
git add src/web/src src/internal/web/dist
git commit -m "feat: add Node Maintenance page (info, workers, repair, blocks)"
```

---

## Task 4: Verify end-to-end (controller)

Start the binary, seed the real cluster, Playwright MCP verify (READ-ONLY against live):
- Node Maintenance page: node selector lists the node; Node info card shows hostname, garage v2.3.0, db engine, features; Statistics freeform renders; Workers table populated; Block errors shows "Không có block lỗi".
- Do NOT trigger repair / snapshot / retry / purge on the live cluster (destructive). Those are covered by mock tests and gated by confirmation modals.

---

## Self-Review

**Spec coverage (Phase 4b = node/worker/block maintenance from the design spec):**
- GetNodeInfo, GetNodeStatistics → Tasks 1,2,3. ✓
- ListWorkers, GetWorkerInfo, GetWorkerVariable, SetWorkerVariable → Tasks 1,2,3 (UI: list + set). ✓
- CreateMetadataSnapshot → Tasks 1,2,3. ✓
- LaunchRepairOperation (all unit repair types) → Tasks 1,2,3. ✓
- ListBlockErrors, GetBlockInfo, RetryBlockResync, PurgeBlocks → Tasks 1,2,3. ✓
- Reads auth; mutations admin (frontend + backend RequireAdmin) → Tasks 2,3. ✓

**Placeholder scan:** No TBD/TODO; all code complete.

**Type consistency:** Client returns `json.RawMessage` envelopes; handlers pass through via `writeRaw` (uses `writeGarageError` on error). Request body field names use snake_case (`repair_type`, `block_hashes`, `variable`, `value`, `block_hash`, `id`) and are mapped to the exact Garage camelCase/array bodies inside the client (`repairType`, `blockHashes`, bare array). Frontend `MultiNode<T>`, `NodeInfoData`, `Worker` match the live JSON; `firstNode` extracts the selected node's entry.

**Safety:** All destructive ops (repair, snapshot, set-variable, retry, purge) are admin-only at the backend and gated by a confirmation modal in the UI; purge has an extra "permanent / cannot undo" warning. Not auto-exercised live.
