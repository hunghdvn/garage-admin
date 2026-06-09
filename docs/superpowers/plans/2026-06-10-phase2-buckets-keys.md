# Phase 2 — Buckets & Access Keys Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add full bucket and access-key management on top of the Phase 1 foundation — list/create/inspect/delete buckets, manage global aliases, quotas, website hosting, and per-key bucket permissions; list/create/import/inspect/rename/delete access keys (showing the secret once on create), plus a cluster selector so every page operates on a chosen cluster.

**Architecture:** Extend the typed Garage Admin API v2 client (`internal/garage`) with bucket and key operations, add `internal/api` handlers under `/api/buckets` and `/api/keys` (auth required; mutations admin-only; all routed to the selected cluster via the existing `garageClientForRequest`), and add React+Mantine pages (Buckets list/detail, Keys list/detail) plus a header cluster selector. Verified against the real Garage v2.3.0 cluster and via Playwright.

**Tech stack:** Same as Phase 1 (Go + chi + Mantine + TanStack Query). No new dependencies.

**Branch:** `phase2-buckets-keys` (off `phase1-foundation`). Module root `src/`; run `go` from `src/`.

**Verified API contract (Garage v2.3.0, observed live):**
- `GET /v2/ListBuckets` → `[{id, created, globalAliases[], localAliases[]}]`
- `GET /v2/GetBucketInfo?id=` → `{id, created, globalAliases[], websiteAccess, websiteConfig?, keys[{accessKeyId,name,permissions{read,write,owner},bucketLocalAliases[]}], objects, bytes, unfinishedUploads, unfinishedMultipartUploads, quotas{maxSize,maxObjects}}`
- `POST /v2/CreateBucket` body `{globalAlias}` → BucketInfo
- `POST /v2/UpdateBucket?id=` body `{websiteAccess?{enabled,indexDocument,errorDocument}, quotas?{maxSize,maxObjects}}` → BucketInfo
- `POST /v2/DeleteBucket?id=` → (empty)
- `POST /v2/AddBucketAlias` / `POST /v2/RemoveBucketAlias` body `{bucketId, globalAlias}`
- `POST /v2/AllowBucketKey` / `POST /v2/DenyBucketKey` body `{bucketId, accessKeyId, permissions{read,write,owner}}`
- `GET /v2/ListKeys` → `[{id, name, created, expiration, expired}]`
- `GET /v2/GetKeyInfo?id=&showSecretKey=true` → `{accessKeyId, created, name, expiration, expired, permissions{createBucket}, buckets[{id,globalAliases[],localAliases[],permissions{read,write,owner}}], secretAccessKey?}`
- `POST /v2/CreateKey` body `{name}` → KeyInfo **including `secretAccessKey`**
- `POST /v2/UpdateKey?id=` body `{name?, allow?{createBucket}, deny?{createBucket}}` → KeyInfo
- `POST /v2/DeleteKey?id=` → (empty)
- `POST /v2/ImportKey` body `{accessKeyId, secretAccessKey, name}` → KeyInfo

---

## File Structure

```
src/internal/garage/
├── buckets.go        # bucket types + client methods (+ buckets_test.go)
└── keys.go           # key types + client methods (+ keys_test.go)
src/internal/api/
├── buckets.go        # /api/buckets handlers (+ buckets_test.go)
├── keys.go           # /api/keys handlers (+ keys_test.go)
└── server.go         # MODIFY: mount buckets + keys
src/web/src/
├── api/client.ts                 # MODIFY: add Bucket/Key types + cluster param interceptor
├── cluster/ClusterContext.tsx    # selected-cluster context
├── components/ClusterSelector.tsx
├── components/AppShell.tsx        # MODIFY: add selector + nav links
├── App.tsx                        # MODIFY: add routes
├── pages/BucketsPage.tsx
├── pages/BucketDetailPage.tsx
├── pages/KeysPage.tsx
└── pages/KeyDetailPage.tsx
```

---

## Task 1: Garage client — bucket operations

**Files:** Create `src/internal/garage/buckets.go`, `src/internal/garage/buckets_test.go`

- [ ] **Step 1: Write `src/internal/garage/buckets_test.go`**

```go
package garage

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestListBuckets(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v2/ListBuckets" {
			t.Errorf("path=%q", r.URL.Path)
		}
		w.Write([]byte(`[{"id":"abc","created":"2026-06-09T16:29:13.800Z","globalAliases":["files"],"localAliases":[]}]`))
	}))
	defer srv.Close()
	got, err := New(srv.URL, "t").ListBuckets()
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].ID != "abc" || got[0].GlobalAliases[0] != "files" {
		t.Errorf("unexpected: %+v", got)
	}
}

func TestGetBucketInfo(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v2/GetBucketInfo" || r.URL.Query().Get("id") != "abc" {
			t.Errorf("path=%q q=%q", r.URL.Path, r.URL.RawQuery)
		}
		w.Write([]byte(`{"id":"abc","created":"x","globalAliases":["files"],"websiteAccess":false,"keys":[{"accessKeyId":"GK1","name":"k","permissions":{"read":true,"write":true,"owner":false},"bucketLocalAliases":[]}],"objects":3,"bytes":99,"unfinishedUploads":0,"unfinishedMultipartUploads":0,"quotas":{"maxSize":null,"maxObjects":null}}`))
	}))
	defer srv.Close()
	got, err := New(srv.URL, "t").GetBucketInfo("abc")
	if err != nil {
		t.Fatal(err)
	}
	if got.Objects != 3 || got.Bytes != 99 || len(got.Keys) != 1 || !got.Keys[0].Permissions.Read {
		t.Errorf("unexpected: %+v", got)
	}
}

func TestCreateBucketSendsGlobalAlias(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v2/CreateBucket" || r.Method != http.MethodPost {
			t.Errorf("path=%q method=%q", r.URL.Path, r.Method)
		}
		var body map[string]any
		b, _ := io.ReadAll(r.Body)
		json.Unmarshal(b, &body)
		if body["globalAlias"] != "newb" {
			t.Errorf("body=%v", body)
		}
		w.Write([]byte(`{"id":"newid","created":"x","globalAliases":["newb"],"websiteAccess":false,"keys":[],"objects":0,"bytes":0,"unfinishedUploads":0,"unfinishedMultipartUploads":0,"quotas":{"maxSize":null,"maxObjects":null}}`))
	}))
	defer srv.Close()
	got, err := New(srv.URL, "t").CreateBucket("newb")
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != "newid" {
		t.Errorf("got %+v", got)
	}
}

func TestUpdateBucketUsesIDQueryAndBody(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v2/UpdateBucket" || r.URL.Query().Get("id") != "abc" {
			t.Errorf("path=%q q=%q", r.URL.Path, r.URL.RawQuery)
		}
		var req UpdateBucketRequest
		b, _ := io.ReadAll(r.Body)
		json.Unmarshal(b, &req)
		if req.Quotas == nil || req.Quotas.MaxObjects == nil || *req.Quotas.MaxObjects != 5 {
			t.Errorf("quotas=%+v", req.Quotas)
		}
		w.Write([]byte(`{"id":"abc","created":"x","globalAliases":[],"websiteAccess":false,"keys":[],"objects":0,"bytes":0,"unfinishedUploads":0,"unfinishedMultipartUploads":0,"quotas":{"maxSize":null,"maxObjects":5}}`))
	}))
	defer srv.Close()
	five := int64(5)
	_, err := New(srv.URL, "t").UpdateBucket("abc", UpdateBucketRequest{Quotas: &Quotas{MaxObjects: &five}})
	if err != nil {
		t.Fatal(err)
	}
}

func TestDeleteBucketUsesIDQuery(t *testing.T) {
	called := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		if r.URL.Path != "/v2/DeleteBucket" || r.URL.Query().Get("id") != "abc" || r.Method != http.MethodPost {
			t.Errorf("path=%q q=%q method=%q", r.URL.Path, r.URL.RawQuery, r.Method)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()
	if err := New(srv.URL, "t").DeleteBucket("abc"); err != nil {
		t.Fatal(err)
	}
	if !called {
		t.Error("not called")
	}
}

func TestAliasAndPermissionEndpoints(t *testing.T) {
	var paths []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()
	c := New(srv.URL, "t")
	if err := c.AddBucketAlias("b", "alias1"); err != nil {
		t.Fatal(err)
	}
	if err := c.RemoveBucketAlias("b", "alias1"); err != nil {
		t.Fatal(err)
	}
	if err := c.AllowBucketKey("b", "GK1", Permissions{Read: true}); err != nil {
		t.Fatal(err)
	}
	if err := c.DenyBucketKey("b", "GK1", Permissions{Owner: true}); err != nil {
		t.Fatal(err)
	}
	want := []string{"/v2/AddBucketAlias", "/v2/RemoveBucketAlias", "/v2/AllowBucketKey", "/v2/DenyBucketKey"}
	for i, p := range want {
		if paths[i] != p {
			t.Errorf("paths[%d]=%q want %q", i, paths[i], p)
		}
	}
}
```

- [ ] **Step 2: Run `go test ./internal/garage/` — confirm FAIL (build error).**

- [ ] **Step 3: Write `src/internal/garage/buckets.go`**

```go
package garage

import (
	"context"
	"net/http"
	"net/url"
)

// Permissions are read/write/owner flags for a key on a bucket.
type Permissions struct {
	Read  bool `json:"read"`
	Write bool `json:"write"`
	Owner bool `json:"owner"`
}

// Quotas are bucket quotas; nil pointer means unlimited.
type Quotas struct {
	MaxSize    *int64 `json:"maxSize"`
	MaxObjects *int64 `json:"maxObjects"`
}

// WebsiteConfig is present when website access is enabled.
type WebsiteConfig struct {
	IndexDocument string `json:"indexDocument"`
	ErrorDocument string `json:"errorDocument"`
}

// BucketListItem is one entry from ListBuckets.
type BucketListItem struct {
	ID            string   `json:"id"`
	Created       string   `json:"created"`
	GlobalAliases []string `json:"globalAliases"`
	LocalAliases  []any    `json:"localAliases"`
}

// BucketKeyPerm is a key's permission on a bucket (within BucketInfo).
type BucketKeyPerm struct {
	AccessKeyID        string      `json:"accessKeyId"`
	Name               string      `json:"name"`
	Permissions        Permissions `json:"permissions"`
	BucketLocalAliases []string    `json:"bucketLocalAliases"`
}

// BucketInfo is the detailed bucket view.
type BucketInfo struct {
	ID                         string          `json:"id"`
	Created                    string          `json:"created"`
	GlobalAliases              []string        `json:"globalAliases"`
	WebsiteAccess              bool            `json:"websiteAccess"`
	WebsiteConfig              *WebsiteConfig  `json:"websiteConfig"`
	Keys                       []BucketKeyPerm `json:"keys"`
	Objects                    int64           `json:"objects"`
	Bytes                      int64           `json:"bytes"`
	UnfinishedUploads          int64           `json:"unfinishedUploads"`
	UnfinishedMultipartUploads int64           `json:"unfinishedMultipartUploads"`
	Quotas                     Quotas          `json:"quotas"`
}

// WebsiteAccessUpdate configures static website hosting on UpdateBucket.
type WebsiteAccessUpdate struct {
	Enabled       bool   `json:"enabled"`
	IndexDocument string `json:"indexDocument,omitempty"`
	ErrorDocument string `json:"errorDocument,omitempty"`
}

// UpdateBucketRequest is the body for UpdateBucket. Nil fields are omitted.
type UpdateBucketRequest struct {
	WebsiteAccess *WebsiteAccessUpdate `json:"websiteAccess,omitempty"`
	Quotas        *Quotas              `json:"quotas,omitempty"`
}

// ListBuckets calls GET /v2/ListBuckets.
func (c *Client) ListBuckets() ([]BucketListItem, error) {
	var out []BucketListItem
	err := c.do(context.Background(), http.MethodGet, "/v2/ListBuckets", nil, &out)
	return out, err
}

// GetBucketInfo calls GET /v2/GetBucketInfo?id=.
func (c *Client) GetBucketInfo(id string) (*BucketInfo, error) {
	var out BucketInfo
	err := c.do(context.Background(), http.MethodGet, "/v2/GetBucketInfo?id="+url.QueryEscape(id), nil, &out)
	return &out, err
}

// CreateBucket calls POST /v2/CreateBucket with a global alias.
func (c *Client) CreateBucket(globalAlias string) (*BucketInfo, error) {
	var out BucketInfo
	body := map[string]string{"globalAlias": globalAlias}
	err := c.do(context.Background(), http.MethodPost, "/v2/CreateBucket", body, &out)
	return &out, err
}

// UpdateBucket calls POST /v2/UpdateBucket?id=.
func (c *Client) UpdateBucket(id string, req UpdateBucketRequest) (*BucketInfo, error) {
	var out BucketInfo
	err := c.do(context.Background(), http.MethodPost, "/v2/UpdateBucket?id="+url.QueryEscape(id), req, &out)
	return &out, err
}

// DeleteBucket calls POST /v2/DeleteBucket?id=.
func (c *Client) DeleteBucket(id string) error {
	return c.do(context.Background(), http.MethodPost, "/v2/DeleteBucket?id="+url.QueryEscape(id), nil, nil)
}

// AddBucketAlias calls POST /v2/AddBucketAlias with a global alias.
func (c *Client) AddBucketAlias(bucketID, globalAlias string) error {
	body := map[string]string{"bucketId": bucketID, "globalAlias": globalAlias}
	return c.do(context.Background(), http.MethodPost, "/v2/AddBucketAlias", body, nil)
}

// RemoveBucketAlias calls POST /v2/RemoveBucketAlias for a global alias.
func (c *Client) RemoveBucketAlias(bucketID, globalAlias string) error {
	body := map[string]string{"bucketId": bucketID, "globalAlias": globalAlias}
	return c.do(context.Background(), http.MethodPost, "/v2/RemoveBucketAlias", body, nil)
}

// AllowBucketKey grants permissions for a key on a bucket.
func (c *Client) AllowBucketKey(bucketID, accessKeyID string, perms Permissions) error {
	body := map[string]any{"bucketId": bucketID, "accessKeyId": accessKeyID, "permissions": perms}
	return c.do(context.Background(), http.MethodPost, "/v2/AllowBucketKey", body, nil)
}

// DenyBucketKey revokes permissions for a key on a bucket.
func (c *Client) DenyBucketKey(bucketID, accessKeyID string, perms Permissions) error {
	body := map[string]any{"bucketId": bucketID, "accessKeyId": accessKeyID, "permissions": perms}
	return c.do(context.Background(), http.MethodPost, "/v2/DenyBucketKey", body, nil)
}
```

- [ ] **Step 4: Run `go test ./internal/garage/` — confirm PASS.**

- [ ] **Step 5: Commit**

```
git add src/internal/garage/buckets.go src/internal/garage/buckets_test.go
git commit -m "feat: add Garage client bucket operations"
```

---

## Task 2: Garage client — key operations

**Files:** Create `src/internal/garage/keys.go`, `src/internal/garage/keys_test.go`

- [ ] **Step 1: Write `src/internal/garage/keys_test.go`**

```go
package garage

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestListKeys(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v2/ListKeys" {
			t.Errorf("path=%q", r.URL.Path)
		}
		w.Write([]byte(`[{"id":"GK1","name":"k","created":"x","expiration":null,"expired":false}]`))
	}))
	defer srv.Close()
	got, err := New(srv.URL, "t").ListKeys()
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].ID != "GK1" || got[0].Name != "k" {
		t.Errorf("got %+v", got)
	}
}

func TestCreateKeyReturnsSecret(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v2/CreateKey" {
			t.Errorf("path=%q", r.URL.Path)
		}
		var body map[string]string
		b, _ := io.ReadAll(r.Body)
		json.Unmarshal(b, &body)
		if body["name"] != "mykey" {
			t.Errorf("body=%v", body)
		}
		w.Write([]byte(`{"accessKeyId":"GK9","secretAccessKey":"SECRET","created":"x","name":"mykey","expiration":null,"expired":false,"permissions":{"createBucket":false},"buckets":[]}`))
	}))
	defer srv.Close()
	got, err := New(srv.URL, "t").CreateKey("mykey")
	if err != nil {
		t.Fatal(err)
	}
	if got.SecretAccessKey == nil || *got.SecretAccessKey != "SECRET" || got.AccessKeyID != "GK9" {
		t.Errorf("got %+v", got)
	}
}

func TestGetKeyInfoShowSecret(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("id") != "GK1" || r.URL.Query().Get("showSecretKey") != "true" {
			t.Errorf("q=%q", r.URL.RawQuery)
		}
		w.Write([]byte(`{"accessKeyId":"GK1","secretAccessKey":"S","created":"x","name":"k","expiration":null,"expired":false,"permissions":{"createBucket":true},"buckets":[{"id":"b1","globalAliases":["files"],"localAliases":[],"permissions":{"read":true,"write":false,"owner":false}}]}`))
	}))
	defer srv.Close()
	got, err := New(srv.URL, "t").GetKeyInfo("GK1", true)
	if err != nil {
		t.Fatal(err)
	}
	if !got.Permissions.CreateBucket || len(got.Buckets) != 1 || got.Buckets[0].ID != "b1" {
		t.Errorf("got %+v", got)
	}
}

func TestUpdateKeyAllowDeny(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v2/UpdateKey" || r.URL.Query().Get("id") != "GK1" {
			t.Errorf("path=%q q=%q", r.URL.Path, r.URL.RawQuery)
		}
		var req UpdateKeyRequest
		b, _ := io.ReadAll(r.Body)
		json.Unmarshal(b, &req)
		if req.Name == nil || *req.Name != "renamed" || req.Allow == nil || !req.Allow.CreateBucket {
			t.Errorf("req=%+v", req)
		}
		w.Write([]byte(`{"accessKeyId":"GK1","created":"x","name":"renamed","expiration":null,"expired":false,"permissions":{"createBucket":true},"buckets":[]}`))
	}))
	defer srv.Close()
	name := "renamed"
	_, err := New(srv.URL, "t").UpdateKey("GK1", UpdateKeyRequest{Name: &name, Allow: &KeyPermissions{CreateBucket: true}})
	if err != nil {
		t.Fatal(err)
	}
}

func TestDeleteAndImportKey(t *testing.T) {
	var paths []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path+"?"+r.URL.RawQuery)
		w.Write([]byte(`{"accessKeyId":"GKimp","created":"x","name":"imp","expiration":null,"expired":false,"permissions":{"createBucket":false},"buckets":[]}`))
	}))
	defer srv.Close()
	c := New(srv.URL, "t")
	if err := c.DeleteKey("GK1"); err != nil {
		t.Fatal(err)
	}
	if _, err := c.ImportKey("GKimp", "sec", "imp"); err != nil {
		t.Fatal(err)
	}
	if paths[0] != "/v2/DeleteKey?id=GK1" || paths[1] != "/v2/ImportKey?" {
		t.Errorf("paths=%v", paths)
	}
}
```

- [ ] **Step 2: Run `go test ./internal/garage/ -run Key` — confirm FAIL.**

- [ ] **Step 3: Write `src/internal/garage/keys.go`**

```go
package garage

import (
	"context"
	"net/http"
	"net/url"
)

// KeyListItem is one entry from ListKeys.
type KeyListItem struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	Created    string  `json:"created"`
	Expiration *string `json:"expiration"`
	Expired    bool    `json:"expired"`
}

// KeyPermissions are global key permissions.
type KeyPermissions struct {
	CreateBucket bool `json:"createBucket"`
}

// KeyBucketPerm is a bucket a key has access to (within KeyInfo).
type KeyBucketPerm struct {
	ID            string      `json:"id"`
	GlobalAliases []string    `json:"globalAliases"`
	LocalAliases  []string    `json:"localAliases"`
	Permissions   Permissions `json:"permissions"`
}

// KeyInfo is the detailed key view. SecretAccessKey is only present on
// create/import or when showSecretKey was requested.
type KeyInfo struct {
	AccessKeyID     string          `json:"accessKeyId"`
	SecretAccessKey *string         `json:"secretAccessKey,omitempty"`
	Created         string          `json:"created"`
	Name            string          `json:"name"`
	Expiration      *string         `json:"expiration"`
	Expired         bool            `json:"expired"`
	Permissions     KeyPermissions  `json:"permissions"`
	Buckets         []KeyBucketPerm `json:"buckets"`
}

// UpdateKeyRequest is the body for UpdateKey. Nil fields are omitted.
type UpdateKeyRequest struct {
	Name  *string         `json:"name,omitempty"`
	Allow *KeyPermissions `json:"allow,omitempty"`
	Deny  *KeyPermissions `json:"deny,omitempty"`
}

// ListKeys calls GET /v2/ListKeys.
func (c *Client) ListKeys() ([]KeyListItem, error) {
	var out []KeyListItem
	err := c.do(context.Background(), http.MethodGet, "/v2/ListKeys", nil, &out)
	return out, err
}

// GetKeyInfo calls GET /v2/GetKeyInfo?id=. If showSecret, the secret is revealed.
func (c *Client) GetKeyInfo(id string, showSecret bool) (*KeyInfo, error) {
	path := "/v2/GetKeyInfo?id=" + url.QueryEscape(id)
	if showSecret {
		path += "&showSecretKey=true"
	}
	var out KeyInfo
	err := c.do(context.Background(), http.MethodGet, path, nil, &out)
	return &out, err
}

// CreateKey calls POST /v2/CreateKey. The response includes the secret.
func (c *Client) CreateKey(name string) (*KeyInfo, error) {
	var out KeyInfo
	err := c.do(context.Background(), http.MethodPost, "/v2/CreateKey", map[string]string{"name": name}, &out)
	return &out, err
}

// UpdateKey calls POST /v2/UpdateKey?id=.
func (c *Client) UpdateKey(id string, req UpdateKeyRequest) (*KeyInfo, error) {
	var out KeyInfo
	err := c.do(context.Background(), http.MethodPost, "/v2/UpdateKey?id="+url.QueryEscape(id), req, &out)
	return &out, err
}

// DeleteKey calls POST /v2/DeleteKey?id=.
func (c *Client) DeleteKey(id string) error {
	return c.do(context.Background(), http.MethodPost, "/v2/DeleteKey?id="+url.QueryEscape(id), nil, nil)
}

// ImportKey calls POST /v2/ImportKey.
func (c *Client) ImportKey(accessKeyID, secretAccessKey, name string) (*KeyInfo, error) {
	body := map[string]string{"accessKeyId": accessKeyID, "secretAccessKey": secretAccessKey, "name": name}
	var out KeyInfo
	err := c.do(context.Background(), http.MethodPost, "/v2/ImportKey", body, &out)
	return &out, err
}
```

- [ ] **Step 4: Run `go test ./internal/garage/` — confirm PASS (all).**

- [ ] **Step 5: Commit**

```
git add src/internal/garage/keys.go src/internal/garage/keys_test.go
git commit -m "feat: add Garage client key operations"
```

---

## Task 3: API handlers — buckets

**Files:** Create `src/internal/api/buckets.go`, `src/internal/api/buckets_test.go`; MODIFY `src/internal/api/server.go`.

All routes require auth; mutations require admin. Cluster is selected via the existing
`garageClientForRequest(r)` helper (in `cluster_status.go`).

- [ ] **Step 1: Modify `src/internal/api/server.go` — register bucket routes.**

In `Routes()`, inside the `/api` group, add `s.mountBuckets(r)` after `s.mountCluster(r)`:
```go
		s.mountCluster(r)
		s.mountBuckets(r)
		s.mountKeys(r)
```
(`mountKeys` is added in Task 4 — add both lines now; Task 4 creates `mountKeys`. To keep this task compiling, also create a temporary stub at the end of `buckets.go`:
```go
// mountKeys is implemented in keys.go (Task 4). Stub kept until then.
```
Do NOT add a stub method — instead, for THIS task only, add just `s.mountBuckets(r)` and leave the `s.mountKeys(r)` line out. Add `s.mountKeys(r)` in Task 4 when `keys.go` exists.)

**Concretely for Task 3:** add only this line after `s.mountCluster(r)`:
```go
		s.mountBuckets(r)
```

- [ ] **Step 2: Write `src/internal/api/buckets_test.go`**

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

// newGarageBackedAPI spins up a fake Garage server and an API server with a
// default cluster pointing at it, logged in as the given role.
func newGarageBackedAPI(t *testing.T, role string, garageHandler http.HandlerFunc) (http.Handler, *http.Cookie) {
	t.Helper()
	gsrv := httptest.NewServer(garageHandler)
	t.Cleanup(gsrv.Close)

	d, err := db.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	hash, _ := auth.HashPassword("pw")
	d.CreateUser("u", hash, role)
	cph, _ := crypto.New([]byte("0123456789abcdef0123456789abcdef"))
	enc, _ := cph.Encrypt("tok")
	d.CreateCluster(&db.Cluster{Name: "c", AdminEndpoint: gsrv.URL, AdminTokenEnc: enc, IsDefault: true})

	srv := &Server{DB: d, Auth: auth.NewService(d), Cipher: cph}
	r := srv.Routes()
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest("POST", "/api/auth/login", strings.NewReader(`{"username":"u","password":"pw"}`)))
	return r, rec.Result().Cookies()[0]
}

func TestListBucketsProxy(t *testing.T) {
	r, cookie := newGarageBackedAPI(t, "admin", func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`[{"id":"abc","created":"x","globalAliases":["files"],"localAliases":[]}]`))
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/api/buckets", nil)
	req.AddCookie(cookie)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "files") {
		t.Fatalf("code=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestCreateBucketRequiresAdmin(t *testing.T) {
	r, cookie := newGarageBackedAPI(t, "readonly", func(w http.ResponseWriter, _ *http.Request) {})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/buckets", strings.NewReader(`{"global_alias":"x"}`))
	req.AddCookie(cookie)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Errorf("code=%d want 403", rec.Code)
	}
}

func TestCreateBucketProxiesGlobalAlias(t *testing.T) {
	r, cookie := newGarageBackedAPI(t, "admin", func(w http.ResponseWriter, req *http.Request) {
		if req.URL.Path != "/v2/CreateBucket" {
			t.Errorf("path=%q", req.URL.Path)
		}
		w.Write([]byte(`{"id":"nid","created":"x","globalAliases":["newb"],"websiteAccess":false,"keys":[],"objects":0,"bytes":0,"unfinishedUploads":0,"unfinishedMultipartUploads":0,"quotas":{"maxSize":null,"maxObjects":null}}`))
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/buckets", strings.NewReader(`{"global_alias":"newb"}`))
	req.AddCookie(cookie)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated || !strings.Contains(rec.Body.String(), "nid") {
		t.Fatalf("code=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestPermissionEndpointProxies(t *testing.T) {
	var gotPath string
	r, cookie := newGarageBackedAPI(t, "admin", func(w http.ResponseWriter, req *http.Request) {
		gotPath = req.URL.Path
		w.WriteHeader(http.StatusOK)
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/buckets/abc/permissions",
		strings.NewReader(`{"access_key_id":"GK1","read":true,"write":true,"owner":false,"deny":false}`))
	req.AddCookie(cookie)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || gotPath != "/v2/AllowBucketKey" {
		t.Fatalf("code=%d path=%q", rec.Code, gotPath)
	}
}
```

- [ ] **Step 3: Run `go test ./internal/api/ -run Bucket` — confirm FAIL.**

- [ ] **Step 4: Write `src/internal/api/buckets.go`**

```go
package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/HungHD/garage-admin/internal/garage"
)

func (s *Server) mountBuckets(r chi.Router) {
	r.Route("/buckets", func(r chi.Router) {
		r.Use(s.Auth.RequireAuth)
		r.Get("/", s.handleListBuckets)
		r.Get("/{id}", s.handleGetBucket)
		r.With(s.Auth.RequireAdmin).Post("/", s.handleCreateBucket)
		r.With(s.Auth.RequireAdmin).Post("/{id}", s.handleUpdateBucket)
		r.With(s.Auth.RequireAdmin).Delete("/{id}", s.handleDeleteBucket)
		r.With(s.Auth.RequireAdmin).Post("/{id}/aliases", s.handleAddBucketAlias)
		r.With(s.Auth.RequireAdmin).Delete("/{id}/aliases/{alias}", s.handleRemoveBucketAlias)
		r.With(s.Auth.RequireAdmin).Post("/{id}/permissions", s.handleBucketPermission)
	})
}

func (s *Server) handleListBuckets(w http.ResponseWriter, r *http.Request) {
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	list, err := client.ListBuckets()
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (s *Server) handleGetBucket(w http.ResponseWriter, r *http.Request) {
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	info, err := client.GetBucketInfo(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, info)
}

func (s *Server) handleCreateBucket(w http.ResponseWriter, r *http.Request) {
	var body struct {
		GlobalAlias string `json:"global_alias"`
	}
	if err := decodeJSON(r, &body); err != nil || body.GlobalAlias == "" {
		writeError(w, http.StatusBadRequest, "global_alias is required")
		return
	}
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	info, err := client.CreateBucket(body.GlobalAlias)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, info)
}

func (s *Server) handleUpdateBucket(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Website *struct {
			Enabled       bool   `json:"enabled"`
			IndexDocument string `json:"index_document"`
			ErrorDocument string `json:"error_document"`
		} `json:"website"`
		Quotas *struct {
			MaxSize    *int64 `json:"max_size"`
			MaxObjects *int64 `json:"max_objects"`
		} `json:"quotas"`
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
	var req garage.UpdateBucketRequest
	if body.Website != nil {
		req.WebsiteAccess = &garage.WebsiteAccessUpdate{
			Enabled:       body.Website.Enabled,
			IndexDocument: body.Website.IndexDocument,
			ErrorDocument: body.Website.ErrorDocument,
		}
	}
	if body.Quotas != nil {
		req.Quotas = &garage.Quotas{MaxSize: body.Quotas.MaxSize, MaxObjects: body.Quotas.MaxObjects}
	}
	info, err := client.UpdateBucket(chi.URLParam(r, "id"), req)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, info)
}

func (s *Server) handleDeleteBucket(w http.ResponseWriter, r *http.Request) {
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	if err := client.DeleteBucket(chi.URLParam(r, "id")); err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleAddBucketAlias(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Alias string `json:"alias"`
	}
	if err := decodeJSON(r, &body); err != nil || body.Alias == "" {
		writeError(w, http.StatusBadRequest, "alias is required")
		return
	}
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	if err := client.AddBucketAlias(chi.URLParam(r, "id"), body.Alias); err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleRemoveBucketAlias(w http.ResponseWriter, r *http.Request) {
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	if err := client.RemoveBucketAlias(chi.URLParam(r, "id"), chi.URLParam(r, "alias")); err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleBucketPermission(w http.ResponseWriter, r *http.Request) {
	var body struct {
		AccessKeyID string `json:"access_key_id"`
		Read        bool   `json:"read"`
		Write       bool   `json:"write"`
		Owner       bool   `json:"owner"`
		Deny        bool   `json:"deny"`
	}
	if err := decodeJSON(r, &body); err != nil || body.AccessKeyID == "" {
		writeError(w, http.StatusBadRequest, "access_key_id is required")
		return
	}
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	perms := garage.Permissions{Read: body.Read, Write: body.Write, Owner: body.Owner}
	id := chi.URLParam(r, "id")
	if body.Deny {
		err = client.DenyBucketKey(id, body.AccessKeyID, perms)
	} else {
		err = client.AllowBucketKey(id, body.AccessKeyID, perms)
	}
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
```

- [ ] **Step 5: Run `go test ./internal/api/` — confirm PASS. Run `go vet ./...`.**

- [ ] **Step 6: Commit**

```
git add src/internal/api/buckets.go src/internal/api/buckets_test.go src/internal/api/server.go
git commit -m "feat: add bucket management API handlers"
```

---

## Task 4: API handlers — keys

**Files:** Create `src/internal/api/keys.go`, `src/internal/api/keys_test.go`; MODIFY `src/internal/api/server.go`.

- [ ] **Step 1: Modify `src/internal/api/server.go` — add `s.mountKeys(r)` right after `s.mountBuckets(r)`.**

- [ ] **Step 2: Write `src/internal/api/keys_test.go`**

```go
package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestListKeysProxy(t *testing.T) {
	r, cookie := newGarageBackedAPI(t, "readonly", func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`[{"id":"GK1","name":"k","created":"x","expiration":null,"expired":false}]`))
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/api/keys", nil)
	req.AddCookie(cookie)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "GK1") {
		t.Fatalf("code=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestCreateKeyReturnsSecretAndRequiresAdmin(t *testing.T) {
	// readonly forbidden
	rRO, cRO := newGarageBackedAPI(t, "readonly", func(w http.ResponseWriter, _ *http.Request) {})
	recRO := httptest.NewRecorder()
	reqRO := httptest.NewRequest("POST", "/api/keys", strings.NewReader(`{"name":"k"}`))
	reqRO.AddCookie(cRO)
	rRO.ServeHTTP(recRO, reqRO)
	if recRO.Code != http.StatusForbidden {
		t.Fatalf("readonly create code=%d want 403", recRO.Code)
	}

	// admin gets the secret back
	r, cookie := newGarageBackedAPI(t, "admin", func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`{"accessKeyId":"GK9","secretAccessKey":"SECRET","created":"x","name":"k","expiration":null,"expired":false,"permissions":{"createBucket":false},"buckets":[]}`))
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/keys", strings.NewReader(`{"name":"k"}`))
	req.AddCookie(cookie)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated || !strings.Contains(rec.Body.String(), "SECRET") {
		t.Fatalf("code=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestUpdateKeyProxiesCreateBucket(t *testing.T) {
	var sawAllow bool
	r, cookie := newGarageBackedAPI(t, "admin", func(w http.ResponseWriter, req *http.Request) {
		if req.URL.Path == "/v2/UpdateKey" {
			b := make([]byte, req.ContentLength)
			req.Body.Read(b)
			sawAllow = strings.Contains(string(b), "allow") || strings.Contains(string(b), "name")
		}
		w.Write([]byte(`{"accessKeyId":"GK1","created":"x","name":"r","expiration":null,"expired":false,"permissions":{"createBucket":true},"buckets":[]}`))
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/keys/GK1", strings.NewReader(`{"name":"r","create_bucket":true}`))
	req.AddCookie(cookie)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !sawAllow {
		t.Fatalf("code=%d sawAllow=%v", rec.Code, sawAllow)
	}
}
```

- [ ] **Step 3: Run `go test ./internal/api/ -run Key` — confirm FAIL.**

- [ ] **Step 4: Write `src/internal/api/keys.go`**

```go
package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/HungHD/garage-admin/internal/auth"
	"github.com/HungHD/garage-admin/internal/garage"
)

func (s *Server) mountKeys(r chi.Router) {
	r.Route("/keys", func(r chi.Router) {
		r.Use(s.Auth.RequireAuth)
		r.Get("/", s.handleListKeys)
		r.Get("/{id}", s.handleGetKey)
		r.With(s.Auth.RequireAdmin).Post("/", s.handleCreateKey)
		r.With(s.Auth.RequireAdmin).Post("/import", s.handleImportKey)
		r.With(s.Auth.RequireAdmin).Post("/{id}", s.handleUpdateKey)
		r.With(s.Auth.RequireAdmin).Delete("/{id}", s.handleDeleteKey)
	})
}

func (s *Server) handleListKeys(w http.ResponseWriter, r *http.Request) {
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	list, err := client.ListKeys()
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (s *Server) handleGetKey(w http.ResponseWriter, r *http.Request) {
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	// Revealing the secret requires admin role.
	reveal := r.URL.Query().Get("reveal") == "1"
	if reveal {
		u := auth.UserFromContext(r.Context())
		if u == nil || u.Role != "admin" {
			writeError(w, http.StatusForbidden, "forbidden")
			return
		}
	}
	info, err := client.GetKeyInfo(chi.URLParam(r, "id"), reveal)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, info)
}

func (s *Server) handleCreateKey(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name string `json:"name"`
	}
	if err := decodeJSON(r, &body); err != nil || body.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	info, err := client.CreateKey(body.Name)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, info)
}

func (s *Server) handleImportKey(w http.ResponseWriter, r *http.Request) {
	var body struct {
		AccessKeyID     string `json:"access_key_id"`
		SecretAccessKey string `json:"secret_access_key"`
		Name            string `json:"name"`
	}
	if err := decodeJSON(r, &body); err != nil || body.AccessKeyID == "" || body.SecretAccessKey == "" {
		writeError(w, http.StatusBadRequest, "access_key_id and secret_access_key are required")
		return
	}
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	info, err := client.ImportKey(body.AccessKeyID, body.SecretAccessKey, body.Name)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, info)
}

func (s *Server) handleUpdateKey(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name         *string `json:"name"`
		CreateBucket *bool   `json:"create_bucket"`
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
	var req garage.UpdateKeyRequest
	req.Name = body.Name
	if body.CreateBucket != nil {
		if *body.CreateBucket {
			req.Allow = &garage.KeyPermissions{CreateBucket: true}
		} else {
			req.Deny = &garage.KeyPermissions{CreateBucket: true}
		}
	}
	info, err := client.UpdateKey(chi.URLParam(r, "id"), req)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, info)
}

func (s *Server) handleDeleteKey(w http.ResponseWriter, r *http.Request) {
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	if err := client.DeleteKey(chi.URLParam(r, "id")); err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
```

- [ ] **Step 5: Run `go test ./...` (from src/) — confirm all PASS. Run `go vet ./...`.**

- [ ] **Step 6: Commit**

```
git add src/internal/api/keys.go src/internal/api/keys_test.go src/internal/api/server.go
git commit -m "feat: add access-key management API handlers"
```

---

## Task 5: Frontend — cluster selector + API types + routes/nav

**Files:** MODIFY `src/web/src/api/client.ts`; create `src/web/src/cluster/ClusterContext.tsx`, `src/web/src/components/ClusterSelector.tsx`; MODIFY `src/web/src/components/AppShell.tsx`, `src/web/src/App.tsx`, `src/web/src/main.tsx`.

- [ ] **Step 1: Append types + cluster param to `src/web/src/api/client.ts`**

Add at the end of the file:
```ts
export interface BucketListItem {
  id: string
  created: string
  globalAliases: string[]
  localAliases: unknown[]
}

export interface Permissions {
  read: boolean
  write: boolean
  owner: boolean
}

export interface BucketKeyPerm {
  accessKeyId: string
  name: string
  permissions: Permissions
  bucketLocalAliases: string[]
}

export interface Quotas {
  maxSize: number | null
  maxObjects: number | null
}

export interface BucketInfo {
  id: string
  created: string
  globalAliases: string[]
  websiteAccess: boolean
  websiteConfig: { indexDocument: string; errorDocument: string } | null
  keys: BucketKeyPerm[]
  objects: number
  bytes: number
  unfinishedUploads: number
  unfinishedMultipartUploads: number
  quotas: Quotas
}

export interface KeyListItem {
  id: string
  name: string
  created: string
  expiration: string | null
  expired: boolean
}

export interface KeyBucketPerm {
  id: string
  globalAliases: string[]
  localAliases: string[]
  permissions: Permissions
}

export interface KeyInfo {
  accessKeyId: string
  secretAccessKey?: string
  created: string
  name: string
  expiration: string | null
  expired: boolean
  permissions: { createBucket: boolean }
  buckets: KeyBucketPerm[]
}

// Selected cluster id (set by ClusterContext); appended to every /api request.
let selectedClusterId: number | null = null
export function setSelectedClusterId(id: number | null) {
  selectedClusterId = id
}

api.interceptors.request.use((config) => {
  if (selectedClusterId != null) {
    config.params = { ...(config.params || {}), cluster: selectedClusterId }
  }
  return config
})
```

- [ ] **Step 2: Create `src/web/src/cluster/ClusterContext.tsx`**

```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, setSelectedClusterId, type Cluster } from '../api/client'

interface ClusterState {
  clusters: Cluster[]
  selectedId: number | null
  setSelectedId: (id: number) => void
}

const ClusterContext = createContext<ClusterState>(null as unknown as ClusterState)
const STORAGE_KEY = 'ga_cluster'

export function ClusterProvider({ children }: { children: ReactNode }) {
  const { data: clusters } = useQuery({
    queryKey: ['clusters'],
    queryFn: async () => (await api.get<Cluster[]>('/clusters')).data,
  })
  const [selectedId, setSelected] = useState<number | null>(() => {
    const v = localStorage.getItem(STORAGE_KEY)
    return v ? Number(v) : null
  })

  // Default to the cluster flagged default (or first) once loaded.
  useEffect(() => {
    if (selectedId == null && clusters && clusters.length > 0) {
      const def = clusters.find((c) => c.is_default) ?? clusters[0]
      setSelected(def.id)
    }
  }, [clusters, selectedId])

  useEffect(() => {
    setSelectedClusterId(selectedId)
    if (selectedId != null) localStorage.setItem(STORAGE_KEY, String(selectedId))
  }, [selectedId])

  function setSelectedId(id: number) {
    setSelected(id)
  }

  return (
    <ClusterContext.Provider value={{ clusters: clusters ?? [], selectedId, setSelectedId }}>
      {children}
    </ClusterContext.Provider>
  )
}

export function useCluster() {
  return useContext(ClusterContext)
}
```

- [ ] **Step 3: Create `src/web/src/components/ClusterSelector.tsx`**

```tsx
import { Select } from '@mantine/core'
import { useQueryClient } from '@tanstack/react-query'
import { useCluster } from '../cluster/ClusterContext'

export function ClusterSelector() {
  const { clusters, selectedId, setSelectedId } = useCluster()
  const qc = useQueryClient()
  if (clusters.length === 0) return null
  return (
    <Select
      size="xs"
      w={180}
      data={clusters.map((c) => ({ value: String(c.id), label: c.name }))}
      value={selectedId != null ? String(selectedId) : null}
      onChange={(v) => {
        if (v) {
          setSelectedId(Number(v))
          // Refetch cluster-scoped data for the newly selected cluster.
          qc.invalidateQueries()
        }
      }}
      allowDeselect={false}
    />
  )
}
```

- [ ] **Step 4: Wrap the app with `ClusterProvider` in `src/web/src/main.tsx`**

Add the import and wrap `<App />` (inside `AuthProvider`):
```tsx
import { ClusterProvider } from './cluster/ClusterContext'
```
Change:
```tsx
          <AuthProvider>
            <App />
          </AuthProvider>
```
to:
```tsx
          <AuthProvider>
            <ClusterProvider>
              <App />
            </ClusterProvider>
          </AuthProvider>
```

- [ ] **Step 5: Add nav links + selector in `src/web/src/components/AppShell.tsx`**

Add imports:
```tsx
import { IconBucket, IconKey } from '@tabler/icons-react'
import { ClusterSelector } from './ClusterSelector'
```
In the header `<Group>` (right side), add `<ClusterSelector />` before `<ThemeSwitcher />`:
```tsx
          <Group>
            <ClusterSelector />
            <ThemeSwitcher />
            <NavLink ... logout ... />
          </Group>
```
In the navbar, add two links after the Dashboard link and before Settings:
```tsx
        <NavLink component={Link} to="/buckets" label="Buckets" active={loc.pathname.startsWith('/buckets')} leftSection={<IconBucket size={18} />} />
        <NavLink component={Link} to="/keys" label="Access Keys" active={loc.pathname.startsWith('/keys')} leftSection={<IconKey size={18} />} />
```

- [ ] **Step 6: Add routes in `src/web/src/App.tsx`**

Add imports:
```tsx
import { BucketsPage } from './pages/BucketsPage'
import { BucketDetailPage } from './pages/BucketDetailPage'
import { KeysPage } from './pages/KeysPage'
import { KeyDetailPage } from './pages/KeyDetailPage'
```
Add routes inside the authenticated `<Routes>` (before the catch-all):
```tsx
        <Route path="/buckets" element={<BucketsPage />} />
        <Route path="/buckets/:id" element={<BucketDetailPage />} />
        <Route path="/keys" element={<KeysPage />} />
        <Route path="/keys/:id" element={<KeyDetailPage />} />
```

- [ ] **Step 7: Build to verify wiring (will fail until Tasks 6–9 add the pages).**

This task does NOT build green on its own because the page imports don't exist yet. That's expected — Tasks 6–9 create them, and Task 10 runs the build. Do a **typecheck-free sanity check** only: confirm the files were created/edited correctly by reading them. Do not run `npm run build` yet.

- [ ] **Step 8: Commit**

```
git add src/web/src/api/client.ts src/web/src/cluster src/web/src/components/ClusterSelector.tsx src/web/src/components/AppShell.tsx src/web/src/App.tsx src/web/src/main.tsx
git commit -m "feat: add cluster selector, bucket/key API types, routes and nav"
```

---

## Task 6: Frontend — Buckets list page

**Files:** Create `src/web/src/pages/BucketsPage.tsx`

- [ ] **Step 1: Create `src/web/src/pages/BucketsPage.tsx`**

```tsx
import { useState } from 'react'
import {
  ActionIcon, Badge, Button, Card, Group, Modal, Stack, Table, TextInput, Title,
} from '@mantine/core'
import { IconPlus, IconTrash } from '@tabler/icons-react'
import { useDisclosure } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, type BucketListItem } from '../api/client'
import { useAuth } from '../auth/AuthContext'

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(1)} ${units[i]}`
}

export function BucketsPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const qc = useQueryClient()
  const [opened, { open, close }] = useDisclosure(false)
  const [alias, setAlias] = useState('')

  const { data: buckets } = useQuery({
    queryKey: ['buckets'],
    queryFn: async () => (await api.get<BucketListItem[]>('/buckets')).data,
  })

  const createMut = useMutation({
    mutationFn: async (globalAlias: string) => (await api.post('/buckets', { global_alias: globalAlias })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['buckets'] })
      notifications.show({ color: 'green', message: 'Đã tạo bucket' })
      close()
      setAlias('')
    },
    onError: () => notifications.show({ color: 'red', message: 'Tạo bucket thất bại' }),
  })

  const deleteMut = useMutation({
    mutationFn: async (id: string) => api.delete(`/buckets/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['buckets'] })
      notifications.show({ color: 'green', message: 'Đã xóa bucket' })
    },
    onError: () => notifications.show({ color: 'red', message: 'Xóa thất bại (bucket phải rỗng)' }),
  })

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={3}>Buckets</Title>
        {isAdmin && <Button leftSection={<IconPlus size={16} />} onClick={open}>Tạo bucket</Button>}
      </Group>
      <Card withBorder>
        <Table highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Alias</Table.Th>
              <Table.Th>ID</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {buckets?.map((b) => (
              <Table.Tr key={b.id}>
                <Table.Td>
                  <Link to={`/buckets/${b.id}`}>
                    {b.globalAliases.length > 0 ? b.globalAliases.join(', ') : <Badge color="gray">no alias</Badge>}
                  </Link>
                </Table.Td>
                <Table.Td><code>{b.id.slice(0, 16)}…</code></Table.Td>
                <Table.Td>
                  {isAdmin && (
                    <ActionIcon color="red" variant="subtle" aria-label="delete"
                      onClick={() => deleteMut.mutate(b.id)}>
                      <IconTrash size={16} />
                    </ActionIcon>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>

      <Modal opened={opened} onClose={close} title="Tạo bucket">
        <Stack>
          <TextInput label="Global alias (tên bucket)" value={alias}
            onChange={(e) => setAlias(e.currentTarget.value)} required />
          <Button onClick={() => createMut.mutate(alias)} loading={createMut.isPending} disabled={!alias}>
            Tạo
          </Button>
        </Stack>
      </Modal>
    </Stack>
  )
}

export { fmtBytes }
```

- [ ] **Step 2: Commit**

```
git add src/web/src/pages/BucketsPage.tsx
git commit -m "feat: add buckets list page"
```

---

## Task 7: Frontend — Bucket detail page

**Files:** Create `src/web/src/pages/BucketDetailPage.tsx`

- [ ] **Step 1: Create `src/web/src/pages/BucketDetailPage.tsx`**

```tsx
import { useEffect, useState } from 'react'
import {
  Anchor, Badge, Button, Card, Checkbox, Grid, Group, NumberInput, Stack,
  Switch, Table, Text, TextInput, Title, Breadcrumbs, Loader,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { api, type BucketInfo } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { fmtBytes } from './BucketsPage'

export function BucketDetailPage() {
  const { id = '' } = useParams()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const qc = useQueryClient()

  const { data: bucket, isLoading } = useQuery({
    queryKey: ['bucket', id],
    queryFn: async () => (await api.get<BucketInfo>(`/buckets/${id}`)).data,
  })

  const [websiteEnabled, setWebsiteEnabled] = useState(false)
  const [indexDoc, setIndexDoc] = useState('index.html')
  const [errorDoc, setErrorDoc] = useState('error.html')
  const [maxSize, setMaxSize] = useState<number | ''>('')
  const [maxObjects, setMaxObjects] = useState<number | ''>('')
  const [newAlias, setNewAlias] = useState('')

  useEffect(() => {
    if (bucket) {
      setWebsiteEnabled(bucket.websiteAccess)
      setIndexDoc(bucket.websiteConfig?.indexDocument || 'index.html')
      setErrorDoc(bucket.websiteConfig?.errorDocument || 'error.html')
      setMaxSize(bucket.quotas.maxSize ?? '')
      setMaxObjects(bucket.quotas.maxObjects ?? '')
    }
  }, [bucket])

  const refresh = () => qc.invalidateQueries({ queryKey: ['bucket', id] })

  const updateMut = useMutation({
    mutationFn: async (body: unknown) => (await api.post(`/buckets/${id}`, body)).data,
    onSuccess: () => {
      refresh()
      notifications.show({ color: 'green', message: 'Đã cập nhật' })
    },
    onError: () => notifications.show({ color: 'red', message: 'Cập nhật thất bại' }),
  })

  const aliasMut = useMutation({
    mutationFn: async (alias: string) => (await api.post(`/buckets/${id}/aliases`, { alias })).data,
    onSuccess: () => { refresh(); setNewAlias('') },
    onError: () => notifications.show({ color: 'red', message: 'Thêm alias thất bại' }),
  })
  const removeAliasMut = useMutation({
    mutationFn: async (alias: string) => api.delete(`/buckets/${id}/aliases/${encodeURIComponent(alias)}`),
    onSuccess: refresh,
  })

  const permMut = useMutation({
    mutationFn: async (p: { access_key_id: string; read: boolean; write: boolean; owner: boolean; deny: boolean }) =>
      (await api.post(`/buckets/${id}/permissions`, p)).data,
    onSuccess: () => { refresh(); notifications.show({ color: 'green', message: 'Đã đổi quyền' }) },
    onError: () => notifications.show({ color: 'red', message: 'Đổi quyền thất bại' }),
  })

  if (isLoading || !bucket) return <Loader />

  function saveWebsite() {
    updateMut.mutate({
      website: { enabled: websiteEnabled, index_document: indexDoc, error_document: errorDoc },
    })
  }
  function saveQuotas() {
    updateMut.mutate({
      quotas: {
        max_size: maxSize === '' ? null : Number(maxSize),
        max_objects: maxObjects === '' ? null : Number(maxObjects),
      },
    })
  }

  return (
    <Stack>
      <Breadcrumbs>
        <Anchor component={Link} to="/buckets">Buckets</Anchor>
        <Text>{bucket.globalAliases[0] ?? bucket.id.slice(0, 12)}</Text>
      </Breadcrumbs>
      <Title order={3}>{bucket.globalAliases.join(', ') || bucket.id.slice(0, 16)}</Title>

      <Grid>
        <Grid.Col span={{ base: 12, md: 3 }}><Card withBorder><Text size="sm" c="dimmed">Objects</Text><Text fw={700}>{bucket.objects}</Text></Card></Grid.Col>
        <Grid.Col span={{ base: 12, md: 3 }}><Card withBorder><Text size="sm" c="dimmed">Dung lượng</Text><Text fw={700}>{fmtBytes(bucket.bytes)}</Text></Card></Grid.Col>
        <Grid.Col span={{ base: 12, md: 3 }}><Card withBorder><Text size="sm" c="dimmed">Multipart dở</Text><Text fw={700}>{bucket.unfinishedMultipartUploads}</Text></Card></Grid.Col>
        <Grid.Col span={{ base: 12, md: 3 }}><Card withBorder><Text size="sm" c="dimmed">Website</Text><Text fw={700}>{bucket.websiteAccess ? 'Bật' : 'Tắt'}</Text></Card></Grid.Col>
      </Grid>

      <Card withBorder>
        <Title order={5} mb="sm">Global aliases</Title>
        <Group>
          {bucket.globalAliases.map((a) => (
            <Badge key={a} rightSection={isAdmin && bucket.globalAliases.length > 1 ?
              <Text style={{ cursor: 'pointer' }} onClick={() => removeAliasMut.mutate(a)}>×</Text> : null}>{a}</Badge>
          ))}
        </Group>
        {isAdmin && (
          <Group mt="sm">
            <TextInput placeholder="alias mới" value={newAlias} onChange={(e) => setNewAlias(e.currentTarget.value)} />
            <Button variant="light" onClick={() => aliasMut.mutate(newAlias)} disabled={!newAlias}>Thêm alias</Button>
          </Group>
        )}
      </Card>

      <Card withBorder>
        <Title order={5} mb="sm">Quota</Title>
        <Group align="end">
          <NumberInput label="Max size (bytes, trống = không giới hạn)" value={maxSize}
            onChange={(v) => setMaxSize(typeof v === 'number' ? v : '')} disabled={!isAdmin} min={0} w={260} />
          <NumberInput label="Max objects" value={maxObjects}
            onChange={(v) => setMaxObjects(typeof v === 'number' ? v : '')} disabled={!isAdmin} min={0} w={200} />
          {isAdmin && <Button onClick={saveQuotas} loading={updateMut.isPending}>Lưu quota</Button>}
        </Group>
      </Card>

      <Card withBorder>
        <Title order={5} mb="sm">Website hosting</Title>
        <Stack>
          <Switch label="Bật static website" checked={websiteEnabled}
            onChange={(e) => setWebsiteEnabled(e.currentTarget.checked)} disabled={!isAdmin} />
          <Group>
            <TextInput label="Index document" value={indexDoc} onChange={(e) => setIndexDoc(e.currentTarget.value)} disabled={!isAdmin || !websiteEnabled} />
            <TextInput label="Error document" value={errorDoc} onChange={(e) => setErrorDoc(e.currentTarget.value)} disabled={!isAdmin || !websiteEnabled} />
          </Group>
          {isAdmin && <Button w={160} onClick={saveWebsite} loading={updateMut.isPending}>Lưu website</Button>}
        </Stack>
      </Card>

      <Card withBorder>
        <Title order={5} mb="sm">Quyền key trên bucket</Title>
        <Table>
          <Table.Thead>
            <Table.Tr><Table.Th>Key</Table.Th><Table.Th>Read</Table.Th><Table.Th>Write</Table.Th><Table.Th>Owner</Table.Th></Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {bucket.keys.map((k) => (
              <Table.Tr key={k.accessKeyId}>
                <Table.Td>{k.name || k.accessKeyId}</Table.Td>
                {(['read', 'write', 'owner'] as const).map((perm) => (
                  <Table.Td key={perm}>
                    <Checkbox
                      checked={k.permissions[perm]}
                      disabled={!isAdmin}
                      onChange={(e) => {
                        const grant = e.currentTarget.checked
                        permMut.mutate({
                          access_key_id: k.accessKeyId,
                          read: perm === 'read' ? grant : false,
                          write: perm === 'write' ? grant : false,
                          owner: perm === 'owner' ? grant : false,
                          deny: !grant,
                        })
                      }}
                    />
                  </Table.Td>
                ))}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        <Text size="xs" c="dimmed" mt="xs">Tick để cấp, bỏ tick để thu hồi từng quyền.</Text>
      </Card>
    </Stack>
  )
}
```

- [ ] **Step 2: Commit**

```
git add src/web/src/pages/BucketDetailPage.tsx
git commit -m "feat: add bucket detail page (quotas, website, aliases, key permissions)"
```

---

## Task 8: Frontend — Keys list page

**Files:** Create `src/web/src/pages/KeysPage.tsx`

- [ ] **Step 1: Create `src/web/src/pages/KeysPage.tsx`**

```tsx
import { useState } from 'react'
import {
  ActionIcon, Badge, Button, Card, Code, CopyButton, Group, Modal, Stack, Table, Text, TextInput, Title, Alert,
} from '@mantine/core'
import { IconPlus, IconTrash, IconDownload, IconCopy, IconCheck } from '@tabler/icons-react'
import { useDisclosure } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, type KeyListItem, type KeyInfo } from '../api/client'
import { useAuth } from '../auth/AuthContext'

export function KeysPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const qc = useQueryClient()
  const [createOpened, createCtl] = useDisclosure(false)
  const [importOpened, importCtl] = useDisclosure(false)
  const [name, setName] = useState('')
  const [impId, setImpId] = useState('')
  const [impSecret, setImpSecret] = useState('')
  const [impName, setImpName] = useState('')
  const [createdSecret, setCreatedSecret] = useState<KeyInfo | null>(null)

  const { data: keys } = useQuery({
    queryKey: ['keys'],
    queryFn: async () => (await api.get<KeyListItem[]>('/keys')).data,
  })

  const createMut = useMutation({
    mutationFn: async (n: string) => (await api.post<KeyInfo>('/keys', { name: n })).data,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['keys'] })
      createCtl.close()
      setName('')
      setCreatedSecret(data) // show the secret once
    },
    onError: () => notifications.show({ color: 'red', message: 'Tạo key thất bại' }),
  })

  const importMut = useMutation({
    mutationFn: async () => (await api.post('/keys/import', { access_key_id: impId, secret_access_key: impSecret, name: impName })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['keys'] })
      importCtl.close()
      setImpId(''); setImpSecret(''); setImpName('')
      notifications.show({ color: 'green', message: 'Đã import key' })
    },
    onError: () => notifications.show({ color: 'red', message: 'Import thất bại' }),
  })

  const deleteMut = useMutation({
    mutationFn: async (id: string) => api.delete(`/keys/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['keys'] }),
  })

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={3}>Access Keys</Title>
        {isAdmin && (
          <Group>
            <Button variant="light" leftSection={<IconDownload size={16} />} onClick={importCtl.open}>Import</Button>
            <Button leftSection={<IconPlus size={16} />} onClick={createCtl.open}>Tạo key</Button>
          </Group>
        )}
      </Group>

      <Card withBorder>
        <Table highlightOnHover>
          <Table.Thead>
            <Table.Tr><Table.Th>Tên</Table.Th><Table.Th>Access Key ID</Table.Th><Table.Th>Trạng thái</Table.Th><Table.Th /></Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {keys?.map((k) => (
              <Table.Tr key={k.id}>
                <Table.Td><Link to={`/keys/${k.id}`}>{k.name || '(no name)'}</Link></Table.Td>
                <Table.Td><code>{k.id}</code></Table.Td>
                <Table.Td>{k.expired ? <Badge color="red">expired</Badge> : <Badge color="green">active</Badge>}</Table.Td>
                <Table.Td>
                  {isAdmin && (
                    <ActionIcon color="red" variant="subtle" aria-label="delete" onClick={() => deleteMut.mutate(k.id)}>
                      <IconTrash size={16} />
                    </ActionIcon>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>

      <Modal opened={createOpened} onClose={createCtl.close} title="Tạo access key">
        <Stack>
          <TextInput label="Tên key" value={name} onChange={(e) => setName(e.currentTarget.value)} required />
          <Button onClick={() => createMut.mutate(name)} loading={createMut.isPending} disabled={!name}>Tạo</Button>
        </Stack>
      </Modal>

      <Modal opened={importOpened} onClose={importCtl.close} title="Import access key">
        <Stack>
          <TextInput label="Access Key ID" value={impId} onChange={(e) => setImpId(e.currentTarget.value)} required />
          <TextInput label="Secret Access Key" value={impSecret} onChange={(e) => setImpSecret(e.currentTarget.value)} required />
          <TextInput label="Tên" value={impName} onChange={(e) => setImpName(e.currentTarget.value)} />
          <Button onClick={() => importMut.mutate()} loading={importMut.isPending} disabled={!impId || !impSecret}>Import</Button>
        </Stack>
      </Modal>

      <Modal opened={createdSecret != null} onClose={() => setCreatedSecret(null)} title="Key đã tạo — lưu secret ngay!" size="lg">
        {createdSecret && (
          <Stack>
            <Alert color="yellow">Secret chỉ hiển thị MỘT LẦN. Hãy sao chép và lưu lại an toàn.</Alert>
            <Text size="sm">Access Key ID</Text>
            <Group><Code>{createdSecret.accessKeyId}</Code></Group>
            <Text size="sm">Secret Access Key</Text>
            <Group>
              <Code>{createdSecret.secretAccessKey}</Code>
              <CopyButton value={createdSecret.secretAccessKey ?? ''}>
                {({ copied, copy }) => (
                  <ActionIcon variant="light" onClick={copy} aria-label="copy">
                    {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                  </ActionIcon>
                )}
              </CopyButton>
            </Group>
            <Button onClick={() => setCreatedSecret(null)}>Đã lưu, đóng</Button>
          </Stack>
        )}
      </Modal>
    </Stack>
  )
}
```

- [ ] **Step 2: Commit**

```
git add src/web/src/pages/KeysPage.tsx
git commit -m "feat: add access keys list page with create/import and one-time secret"
```

---

## Task 9: Frontend — Key detail page

**Files:** Create `src/web/src/pages/KeyDetailPage.tsx`

- [ ] **Step 1: Create `src/web/src/pages/KeyDetailPage.tsx`**

```tsx
import { useEffect, useState } from 'react'
import {
  Anchor, Badge, Breadcrumbs, Button, Card, Group, Loader, Stack, Switch, Table, Text, TextInput, Title,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { api, type KeyInfo } from '../api/client'
import { useAuth } from '../auth/AuthContext'

export function KeyDetailPage() {
  const { id = '' } = useParams()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const qc = useQueryClient()

  const { data: key, isLoading } = useQuery({
    queryKey: ['key', id],
    queryFn: async () => (await api.get<KeyInfo>(`/keys/${id}`)).data,
  })

  const [name, setName] = useState('')
  const [createBucket, setCreateBucket] = useState(false)
  useEffect(() => {
    if (key) {
      setName(key.name)
      setCreateBucket(key.permissions.createBucket)
    }
  }, [key])

  const updateMut = useMutation({
    mutationFn: async (body: unknown) => (await api.post(`/keys/${id}`, body)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['key', id] })
      qc.invalidateQueries({ queryKey: ['keys'] })
      notifications.show({ color: 'green', message: 'Đã cập nhật' })
    },
    onError: () => notifications.show({ color: 'red', message: 'Cập nhật thất bại' }),
  })

  if (isLoading || !key) return <Loader />

  return (
    <Stack>
      <Breadcrumbs>
        <Anchor component={Link} to="/keys">Access Keys</Anchor>
        <Text>{key.name || key.accessKeyId}</Text>
      </Breadcrumbs>
      <Title order={3}>{key.name || key.accessKeyId}</Title>

      <Card withBorder>
        <Stack>
          <Group><Text w={140} c="dimmed">Access Key ID</Text><code>{key.accessKeyId}</code></Group>
          <Group><Text w={140} c="dimmed">Trạng thái</Text>{key.expired ? <Badge color="red">expired</Badge> : <Badge color="green">active</Badge>}</Group>
          <Group align="end">
            <TextInput label="Tên" value={name} onChange={(e) => setName(e.currentTarget.value)} disabled={!isAdmin} />
            {isAdmin && <Button variant="light" onClick={() => updateMut.mutate({ name })}>Đổi tên</Button>}
          </Group>
          <Switch label="Cho phép tạo bucket (createBucket)" checked={createBucket} disabled={!isAdmin}
            onChange={(e) => { setCreateBucket(e.currentTarget.checked); updateMut.mutate({ create_bucket: e.currentTarget.checked }) }} />
        </Stack>
      </Card>

      <Card withBorder>
        <Title order={5} mb="sm">Bucket có quyền truy cập</Title>
        <Table>
          <Table.Thead>
            <Table.Tr><Table.Th>Bucket</Table.Th><Table.Th>Read</Table.Th><Table.Th>Write</Table.Th><Table.Th>Owner</Table.Th></Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {key.buckets.map((b) => (
              <Table.Tr key={b.id}>
                <Table.Td>
                  <Anchor component={Link} to={`/buckets/${b.id}`}>
                    {b.globalAliases[0] ?? b.id.slice(0, 12)}
                  </Anchor>
                </Table.Td>
                <Table.Td>{b.permissions.read ? '✓' : ''}</Table.Td>
                <Table.Td>{b.permissions.write ? '✓' : ''}</Table.Td>
                <Table.Td>{b.permissions.owner ? '✓' : ''}</Table.Td>
              </Table.Tr>
            ))}
            {key.buckets.length === 0 && (
              <Table.Tr><Table.Td colSpan={4}><Text c="dimmed" size="sm">Chưa có quyền trên bucket nào. Cấp quyền ở trang chi tiết bucket.</Text></Table.Td></Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Card>
    </Stack>
  )
}
```

- [ ] **Step 2: Commit**

```
git add src/web/src/pages/KeyDetailPage.tsx
git commit -m "feat: add key detail page (rename, createBucket, bucket access)"
```

---

## Task 10: Build, embed, and verify end-to-end

**Files:** rebuilt `src/internal/web/dist/*`

- [ ] **Step 1: Build the frontend**

```bash
cd /Users/hunghd/Repositories/garage-admin/src/web && npm run build
```
Expected: TypeScript compiles, bundle written to `../internal/web/dist`. Fix any TS errors minimally (e.g. unused imports flagged by `noUnusedLocals`).

- [ ] **Step 2: Rebuild the Go binary**

```bash
cd /Users/hunghd/Repositories/garage-admin/src && go build ./... && go test ./...
```
Expected: builds and all tests pass.

- [ ] **Step 3: Verify end-to-end with the running binary + Playwright MCP (controller does this)**

The controller will: start the binary on a spare port with a temp DB, log in, ensure the real cluster is configured (Settings), then exercise:
- Buckets list shows `files`; open detail → objects/bytes/quota/website/key-permission table render.
- Keys list shows `s3-main`; open detail → bucket access table shows `files` with read/write/owner.
- (Read-only checks only against live data; avoid destructive mutations on the shared cluster unless the user approves.)

- [ ] **Step 4: Commit the rebuilt assets**

```bash
cd /Users/hunghd/Repositories/garage-admin
git add src/internal/web/dist
git commit -m "build: rebuild frontend with buckets and keys pages"
```

---

## Self-Review

**Spec coverage (Phase 2 = "Quản lý Bucket" + "Quản lý Access Key" from the design spec):**
- Buckets list/create/delete → Tasks 3, 6. ✓
- Bucket info (objects/bytes/uploads), quotas, website config → Tasks 1, 3, 7. ✓
- Bucket global aliases add/remove → Tasks 1, 3, 7. ✓
- Per-key bucket permissions (allow/deny read/write/owner) → Tasks 1, 3, 7. ✓
- Keys list/create (secret shown once)/import/delete → Tasks 2, 4, 8. ✓
- Key info, rename, createBucket permission, bucket access list → Tasks 2, 4, 9. ✓
- Multi-cluster: cluster selector routes all calls via `?cluster=` → Task 5. ✓
- Read-only role blocked on mutations (backend RequireAdmin + frontend hides controls) → Tasks 3, 4, 6–9. ✓

**Placeholder scan:** No TBD/TODO; every code step is complete.

**Type consistency:** Garage client structs (`Permissions`, `Quotas`, `BucketInfo`, `KeyInfo`, `UpdateBucketRequest`, `UpdateKeyRequest`) are used consistently across `garage` and `api`. Frontend TS interfaces mirror the JSON the handlers pass through from Garage (camelCase as Garage emits — buckets/keys handlers return the raw Garage structs, so the frontend types use Garage's camelCase field names: `globalAliases`, `accessKeyId`, etc.). API request bodies use snake_case (`global_alias`, `access_key_id`, `create_bucket`, `max_size`) consistently between handlers and frontend.

**Note on field casing:** The `/api/buckets` and `/api/keys` GET responses pass Garage's JSON through unchanged (camelCase). The frontend bucket/key types therefore use camelCase, while the Phase 1 cluster endpoints use snake_case. This is intentional (proxy passthrough) and the TS interfaces match accordingly.
