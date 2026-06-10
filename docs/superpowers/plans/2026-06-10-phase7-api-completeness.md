# Phase 7 — Full Admin API Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Close the remaining Admin API gaps for 100% coverage: bucket `CleanupIncompleteUploads`, `InspectObject`, **local aliases**, **CORS rules**; access-key **expiration**; **UpdateAdminToken** edit UI; and wire the already-built `GetWorkerInfo` / `GetWorkerVariable` / `GetBlockInfo` endpoints into the UI.

**Architecture:** Extend the Garage client and API handlers for the new bucket/key capabilities (exact contracts verified from Garage v2.3.0 source); CORS rules are passed through as raw JSON (`corsRules`) to avoid guessing inner field names. Wire existing-but-unused node endpoints into the Node Maintenance page. Verified live against Garage v2.3.0.

**Tech stack:** Same as prior phases. No new dependencies.

**Branch:** `phase7-api-completeness` (off `main`). Module root `src/`; run `go` from `src/`.

**Verified contracts (Garage v2.3.0 source):**
- `POST /v2/CleanupIncompleteUploads` body `{bucketId, olderThanSecs}`
- `GET /v2/InspectObject?bucketId=&key=`
- `POST /v2/AddBucketAlias` / `RemoveBucketAlias` — global `{bucketId, globalAlias}` OR local `{bucketId, localAlias, accessKeyId}`
- `CreateKey` body = `{name, expiration?, neverExpires, allow?, deny?}` (camelCase); `UpdateKey?id=` same body
- `UpdateBucket?id=` body may include `corsRules` (array); `GetBucketInfo` returns `corsRules`
- `UpdateAdminToken?id=` body `{name, scope, expiration, neverExpires}` (already in client from Phase 4a)

---

## Task 1: Garage client — bucket extensions (cleanup, inspect, local alias, CORS)

**Files:** MODIFY `src/internal/garage/buckets.go`; create `src/internal/garage/buckets_extra_test.go`

- [ ] **Step 1: Write `src/internal/garage/buckets_extra_test.go`**

```go
package garage

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCleanupIncompleteUploads(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v2/CleanupIncompleteUploads" {
			t.Errorf("path=%q", r.URL.Path)
		}
		var body map[string]any
		b, _ := io.ReadAll(r.Body)
		json.Unmarshal(b, &body)
		if body["bucketId"] != "bid" || body["olderThanSecs"] == nil {
			t.Errorf("body=%v", body)
		}
		w.Write([]byte(`{"uploadsDeleted":3}`))
	}))
	defer srv.Close()
	if _, err := New(srv.URL, "t").CleanupIncompleteUploads("bid", 3600); err != nil {
		t.Fatal(err)
	}
}

func TestInspectObject(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v2/InspectObject" || r.URL.Query().Get("bucketId") != "bid" || r.URL.Query().Get("key") != "a/b.txt" {
			t.Errorf("path=%q q=%q", r.URL.Path, r.URL.RawQuery)
		}
		w.Write([]byte(`{"bucketId":"bid","key":"a/b.txt","versions":[]}`))
	}))
	defer srv.Close()
	raw, err := New(srv.URL, "t").InspectObject("bid", "a/b.txt")
	if err != nil || len(raw) == 0 {
		t.Fatalf("err=%v raw=%s", err, raw)
	}
}

func TestLocalAlias(t *testing.T) {
	var bodies []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		bodies = append(bodies, r.URL.Path+" "+string(b))
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()
	c := New(srv.URL, "t")
	if err := c.AddBucketAliasLocal("bid", "myalias", "GK1"); err != nil {
		t.Fatal(err)
	}
	if err := c.RemoveBucketAliasLocal("bid", "myalias", "GK1"); err != nil {
		t.Fatal(err)
	}
	want0 := `/v2/AddBucketAlias {"accessKeyId":"GK1","bucketId":"bid","localAlias":"myalias"}`
	want1 := `/v2/RemoveBucketAlias {"accessKeyId":"GK1","bucketId":"bid","localAlias":"myalias"}`
	if bodies[0] != want0 {
		t.Errorf("add local body=%s want %s", bodies[0], want0)
	}
	if bodies[1] != want1 {
		t.Errorf("remove local body=%s want %s", bodies[1], want1)
	}
}

func TestUpdateBucketCorsPassthrough(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]json.RawMessage
		b, _ := io.ReadAll(r.Body)
		json.Unmarshal(b, &body)
		if _, ok := body["corsRules"]; !ok {
			t.Errorf("missing corsRules in body=%s", b)
		}
		w.Write([]byte(`{"id":"bid","created":"x","globalAliases":[],"websiteAccess":false,"keys":[],"objects":0,"bytes":0,"unfinishedUploads":0,"unfinishedMultipartUploads":0,"quotas":{"maxSize":null,"maxObjects":null}}`))
	}))
	defer srv.Close()
	rules := json.RawMessage(`[{"allowOrigins":["*"],"allowMethods":["GET"]}]`)
	_, err := New(srv.URL, "t").UpdateBucket("bid", UpdateBucketRequest{CorsRules: &rules})
	if err != nil {
		t.Fatal(err)
	}
}
```

- [ ] **Step 2: Run `go test ./internal/garage/ -run 'Cleanup|Inspect|LocalAlias|Cors'` — confirm FAIL.**

- [ ] **Step 3: Modify `src/internal/garage/buckets.go`**

(a) Add `"encoding/json"` to the imports.

(b) Add `CorsRules` to `BucketInfo` (after the `Quotas` field) and to `UpdateBucketRequest`:
```go
// in BucketInfo struct, add:
	CorsRules json.RawMessage `json:"corsRules,omitempty"`
```
```go
// replace UpdateBucketRequest with:
type UpdateBucketRequest struct {
	WebsiteAccess *WebsiteAccessUpdate `json:"websiteAccess,omitempty"`
	Quotas        *Quotas              `json:"quotas,omitempty"`
	CorsRules     *json.RawMessage     `json:"corsRules,omitempty"`
}
```

(c) Add these methods at the end of the file:
```go
// CleanupIncompleteUploads removes incomplete multipart uploads older than olderThanSecs.
func (c *Client) CleanupIncompleteUploads(bucketID string, olderThanSecs int64) (json.RawMessage, error) {
	body := map[string]any{"bucketId": bucketID, "olderThanSecs": olderThanSecs}
	var out json.RawMessage
	err := c.do(context.Background(), http.MethodPost, "/v2/CleanupIncompleteUploads", body, &out)
	return out, err
}

// InspectObject returns internal details for an object. GET /v2/InspectObject?bucketId=&key=
func (c *Client) InspectObject(bucketID, key string) (json.RawMessage, error) {
	path := "/v2/InspectObject?bucketId=" + url.QueryEscape(bucketID) + "&key=" + url.QueryEscape(key)
	var out json.RawMessage
	err := c.do(context.Background(), http.MethodGet, path, nil, &out)
	return out, err
}

// AddBucketAliasLocal adds a local (key-scoped) alias.
func (c *Client) AddBucketAliasLocal(bucketID, localAlias, accessKeyID string) error {
	body := map[string]string{"bucketId": bucketID, "localAlias": localAlias, "accessKeyId": accessKeyID}
	return c.do(context.Background(), http.MethodPost, "/v2/AddBucketAlias", body, nil)
}

// RemoveBucketAliasLocal removes a local alias.
func (c *Client) RemoveBucketAliasLocal(bucketID, localAlias, accessKeyID string) error {
	body := map[string]string{"bucketId": bucketID, "localAlias": localAlias, "accessKeyId": accessKeyID}
	return c.do(context.Background(), http.MethodPost, "/v2/RemoveBucketAlias", body, nil)
}
```
(`url` and `context`/`http` are already imported in buckets.go.)

- [ ] **Step 4: Run `go test ./internal/garage/` — confirm PASS.**

- [ ] **Step 5: Commit**

```
git add src/internal/garage/buckets.go src/internal/garage/buckets_extra_test.go
git commit -m "feat: client support for cleanup-uploads, inspect-object, local aliases, CORS"
```

---

## Task 2: Garage client — key expiration

**Files:** MODIFY `src/internal/garage/keys.go`; create `src/internal/garage/keys_extra_test.go`

- [ ] **Step 1: Write `src/internal/garage/keys_extra_test.go`**

```go
package garage

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCreateKeyWithExpiration(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		b, _ := io.ReadAll(r.Body)
		json.Unmarshal(b, &body)
		if body["name"] != "k" || body["expiration"] != "2030-01-01T00:00:00Z" {
			t.Errorf("body=%v", body)
		}
		w.Write([]byte(`{"accessKeyId":"GK9","secretAccessKey":"S","created":"x","name":"k","expiration":"2030-01-01T00:00:00Z","expired":false,"permissions":{"createBucket":false},"buckets":[]}`))
	}))
	defer srv.Close()
	exp := "2030-01-01T00:00:00Z"
	if _, err := New(srv.URL, "t").CreateKey(KeyCreateRequest{Name: "k", Expiration: &exp}); err != nil {
		t.Fatal(err)
	}
}

func TestUpdateKeyExpiration(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		b, _ := io.ReadAll(r.Body)
		json.Unmarshal(b, &body)
		if body["neverExpires"] != true {
			t.Errorf("body=%v", body)
		}
		w.Write([]byte(`{"accessKeyId":"GK1","created":"x","name":"k","expiration":null,"expired":false,"permissions":{"createBucket":false},"buckets":[]}`))
	}))
	defer srv.Close()
	if _, err := New(srv.URL, "t").UpdateKey("GK1", UpdateKeyRequest{NeverExpires: true}); err != nil {
		t.Fatal(err)
	}
}
```

- [ ] **Step 2: Run `go test ./internal/garage/ -run Key` — confirm FAIL (KeyCreateRequest undefined; NeverExpires field missing).**

- [ ] **Step 3: Modify `src/internal/garage/keys.go`**

(a) Replace the `UpdateKeyRequest` struct with one that includes expiration:
```go
// UpdateKeyRequest is the body for UpdateKey. Nil/zero fields are omitted.
type UpdateKeyRequest struct {
	Name         *string         `json:"name,omitempty"`
	Expiration   *string         `json:"expiration,omitempty"`
	NeverExpires bool            `json:"neverExpires,omitempty"`
	Allow        *KeyPermissions `json:"allow,omitempty"`
	Deny         *KeyPermissions `json:"deny,omitempty"`
}

// KeyCreateRequest is the body for CreateKey.
type KeyCreateRequest struct {
	Name         string  `json:"name"`
	Expiration   *string `json:"expiration,omitempty"`
	NeverExpires bool    `json:"neverExpires,omitempty"`
}
```

(b) Replace the `CreateKey` method to take a `KeyCreateRequest`:
```go
// CreateKey calls POST /v2/CreateKey. The response includes the secret.
func (c *Client) CreateKey(req KeyCreateRequest) (*KeyInfo, error) {
	var out KeyInfo
	err := c.do(context.Background(), http.MethodPost, "/v2/CreateKey", req, &out)
	return &out, err
}
```

- [ ] **Step 4: Fix the existing caller and test.**

In `src/internal/garage/keys_test.go`, the existing `TestCreateKeyReturnsSecret` calls `c.CreateKey("mykey")` and the fake checks `body["name"]=="mykey"`. Update that call to:
```go
	got, err := New(srv.URL, "t").CreateKey(KeyCreateRequest{Name: "mykey"})
```
(The handler-side body assertion `body["name"] != "mykey"` still holds.)

- [ ] **Step 5: Run `go test ./internal/garage/` — confirm PASS (all). Build will still fail at the api layer (handleCreateKey calls old CreateKey) — that's fixed in Task 3; do NOT run `go build ./...` yet, just the garage package test.**

- [ ] **Step 6: Commit**

```
git add src/internal/garage/keys.go src/internal/garage/keys_test.go src/internal/garage/keys_extra_test.go
git commit -m "feat: client support for access-key expiration"
```

---

## Task 3: API handlers — bucket extensions + key expiration

**Files:** MODIFY `src/internal/api/buckets.go`, `src/internal/api/keys.go`; create `src/internal/api/completeness_test.go`.

- [ ] **Step 1: Write `src/internal/api/completeness_test.go`**

```go
package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCleanupUploadsRequiresAdmin(t *testing.T) {
	r, cookie := newGarageBackedAPI(t, "readonly", func(w http.ResponseWriter, _ *http.Request) {})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/buckets/bid/cleanup-uploads", strings.NewReader(`{"older_than_secs":3600}`))
	req.AddCookie(cookie)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Errorf("code=%d want 403", rec.Code)
	}
}

func TestInspectObjectProxy(t *testing.T) {
	r, cookie := newGarageBackedAPI(t, "readonly", func(w http.ResponseWriter, req *http.Request) {
		if req.URL.Path != "/v2/InspectObject" || req.URL.Query().Get("bucketId") != "bid" || req.URL.Query().Get("key") != "f.txt" {
			t.Errorf("path=%q q=%q", req.URL.Path, req.URL.RawQuery)
		}
		w.Write([]byte(`{"key":"f.txt","versions":[]}`))
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/api/buckets/bid/inspect?key=f.txt", nil)
	req.AddCookie(cookie)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "versions") {
		t.Fatalf("code=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestLocalAliasProxy(t *testing.T) {
	var gotBody string
	r, cookie := newGarageBackedAPI(t, "admin", func(w http.ResponseWriter, req *http.Request) {
		if req.URL.Path == "/v2/AddBucketAlias" {
			b := make([]byte, req.ContentLength)
			req.Body.Read(b)
			gotBody = string(b)
		}
		w.WriteHeader(http.StatusOK)
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/buckets/bid/aliases", strings.NewReader(`{"alias":"al","local":true,"access_key_id":"GK1"}`))
	req.AddCookie(cookie)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(gotBody, "localAlias") || !strings.Contains(gotBody, "GK1") {
		t.Fatalf("code=%d body=%s", rec.Code, gotBody)
	}
}

func TestCreateKeyWithExpirationProxy(t *testing.T) {
	var gotBody string
	r, cookie := newGarageBackedAPI(t, "admin", func(w http.ResponseWriter, req *http.Request) {
		if req.URL.Path == "/v2/CreateKey" {
			b := make([]byte, req.ContentLength)
			req.Body.Read(b)
			gotBody = string(b)
		}
		w.Write([]byte(`{"accessKeyId":"GK9","secretAccessKey":"S","created":"x","name":"k","expiration":null,"expired":false,"permissions":{"createBucket":false},"buckets":[]}`))
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/keys", strings.NewReader(`{"name":"k","expiration":"2030-01-01T00:00:00Z"}`))
	req.AddCookie(cookie)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated || !strings.Contains(gotBody, "expiration") {
		t.Fatalf("code=%d body=%s", rec.Code, gotBody)
	}
}
```

- [ ] **Step 2: Run `go test ./internal/api/ -run 'Cleanup|Inspect|LocalAlias|CreateKeyWithExpiration'` — confirm FAIL.**

- [ ] **Step 3: Modify `src/internal/api/buckets.go`**

(a) In `mountBuckets`, add routes inside the `/buckets` group:
```go
		r.Get("/{id}/inspect", s.handleInspectObject)
		r.With(s.Auth.RequireAdmin).Post("/{id}/cleanup-uploads", s.handleCleanupUploads)
```
(place alongside the existing `{id}` routes.)

(b) Update `handleAddBucketAlias` to support local aliases. Replace it with:
```go
func (s *Server) handleAddBucketAlias(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Alias       string `json:"alias"`
		Local       bool   `json:"local"`
		AccessKeyID string `json:"access_key_id"`
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
	id := chi.URLParam(r, "id")
	if body.Local {
		if body.AccessKeyID == "" {
			writeError(w, http.StatusBadRequest, "access_key_id is required for a local alias")
			return
		}
		err = client.AddBucketAliasLocal(id, body.Alias, body.AccessKeyID)
	} else {
		err = client.AddBucketAlias(id, body.Alias)
	}
	if err != nil {
		writeGarageError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
```

(c) Update `handleRemoveBucketAlias` to support local. Replace it with:
```go
func (s *Server) handleRemoveBucketAlias(w http.ResponseWriter, r *http.Request) {
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	id := chi.URLParam(r, "id")
	alias := chi.URLParam(r, "alias")
	if akid := r.URL.Query().Get("access_key_id"); akid != "" {
		err = client.RemoveBucketAliasLocal(id, alias, akid)
	} else {
		err = client.RemoveBucketAlias(id, alias)
	}
	if err != nil {
		writeGarageError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
```

(d) Extend `handleUpdateBucket` to accept CORS rules. In its body struct add a `Cors` field and pass it through. Replace the body struct + the `req` assembly:
```go
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
		CorsRules *json.RawMessage `json:"cors_rules"`
	}
```
and after building `req` from website/quotas, add:
```go
	if body.CorsRules != nil {
		req.CorsRules = body.CorsRules
	}
```
Add `"encoding/json"` to buckets.go imports.

(e) Add the two new handlers at the end of buckets.go:
```go
func (s *Server) handleCleanupUploads(w http.ResponseWriter, r *http.Request) {
	var body struct {
		OlderThanSecs int64 `json:"older_than_secs"`
	}
	if err := decodeJSON(r, &body); err != nil || body.OlderThanSecs <= 0 {
		writeError(w, http.StatusBadRequest, "older_than_secs must be > 0")
		return
	}
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	raw, err := client.CleanupIncompleteUploads(chi.URLParam(r, "id"), body.OlderThanSecs)
	if err != nil {
		writeGarageError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(raw)
}

func (s *Server) handleInspectObject(w http.ResponseWriter, r *http.Request) {
	key := r.URL.Query().Get("key")
	if key == "" {
		writeError(w, http.StatusBadRequest, "key is required")
		return
	}
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	raw, err := client.InspectObject(chi.URLParam(r, "id"), key)
	if err != nil {
		writeGarageError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(raw)
}
```

- [ ] **Step 4: Modify `src/internal/api/keys.go`** — accept expiration on create/update.

Replace `handleCreateKey`'s body + call:
```go
func (s *Server) handleCreateKey(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name       string  `json:"name"`
		Expiration *string `json:"expiration"`
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
	req := garage.KeyCreateRequest{Name: body.Name, Expiration: body.Expiration, NeverExpires: body.Expiration == nil}
	info, err := client.CreateKey(req)
	if err != nil {
		writeGarageError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, info)
}
```
In `handleUpdateKey`, extend the body and the `garage.UpdateKeyRequest`:
```go
	var body struct {
		Name         *string `json:"name"`
		CreateBucket *bool   `json:"create_bucket"`
		Expiration   *string `json:"expiration"`
		NeverExpires *bool   `json:"never_expires"`
	}
	...
	var req garage.UpdateKeyRequest
	req.Name = body.Name
	if body.CreateBucket != nil {
		if *body.CreateBucket {
			req.Allow = &garage.KeyPermissions{CreateBucket: true}
		} else {
			req.Deny = &garage.KeyPermissions{CreateBucket: true}
		}
	}
	if body.Expiration != nil {
		req.Expiration = body.Expiration
	}
	if body.NeverExpires != nil {
		req.NeverExpires = *body.NeverExpires
	}
```

- [ ] **Step 5: Run `go test ./...` (from src/) — confirm all PASS. `go vet ./...`.**

- [ ] **Step 6: Commit**

```
git add src/internal/api/buckets.go src/internal/api/keys.go src/internal/api/completeness_test.go
git commit -m "feat: API for cleanup-uploads, inspect-object, local aliases, CORS, key expiration"
```

---

## Task 4: Frontend — bucket detail (cleanup, local alias, CORS), keys (expiration), admin-token edit

**Files:** MODIFY `src/web/src/api/client.ts`, `src/web/src/pages/BucketDetailPage.tsx`, `src/web/src/pages/KeysPage.tsx`, `src/web/src/pages/KeyDetailPage.tsx`, `src/web/src/pages/AdminTokensPage.tsx`.

- [ ] **Step 1: `client.ts`** — add `cors_rules`-capable fields to `BucketInfo` (it currently has no CORS). Add to the `BucketInfo` interface:
```ts
  corsRules?: unknown
```
(append inside the interface; it's optional passthrough.)

- [ ] **Step 2: `BucketDetailPage.tsx`** — add three things. After the existing "Global aliases" card, add a **Local aliases** add form, a **CORS** card, and a **Cleanup uploads** button near the multipart count.

(a) Add state near the other useState hooks:
```tsx
  const [localAlias, setLocalAlias] = useState('')
  const [localKey, setLocalKey] = useState<string | null>(null)
  const [corsText, setCorsText] = useState('')
```
(b) Add `useEffect` to seed corsText from the bucket (after the existing effect that seeds quotas/website):
```tsx
  useEffect(() => {
    if (bucket) setCorsText(JSON.stringify((bucket as any).corsRules ?? [], null, 2))
  }, [bucket])
```
(c) Add mutations near the others:
```tsx
  const localAliasMut = useMutation({
    mutationFn: async () => (await api.post(`/buckets/${id}/aliases`, { alias: localAlias, local: true, access_key_id: localKey })).data,
    onSuccess: () => { refresh(); setLocalAlias(''); setLocalKey(null); notifications.show({ color: 'green', message: 'Đã thêm local alias' }) },
    onError: (e: any) => notifications.show({ color: 'red', message: e?.response?.data?.error || 'Thêm local alias thất bại' }),
  })
  const corsMut = useMutation({
    mutationFn: async () => {
      const rules = JSON.parse(corsText || '[]')
      return (await api.post(`/buckets/${id}`, { cors_rules: rules })).data
    },
    onSuccess: () => { refresh(); notifications.show({ color: 'green', message: 'Đã lưu CORS' }) },
    onError: (e: any) => notifications.show({ color: 'red', message: e?.response?.data?.error || 'Lưu CORS thất bại (kiểm tra JSON)' }),
  })
  const cleanupMut = useMutation({
    mutationFn: async () => (await api.post(`/buckets/${id}/cleanup-uploads`, { older_than_secs: 86400 })).data,
    onSuccess: () => { refresh(); notifications.show({ color: 'green', message: 'Đã dọn multipart upload dở (>24h)' }) },
    onError: (e: any) => notifications.show({ color: 'red', message: e?.response?.data?.error || 'Dọn thất bại' }),
  })
```
(d) In the "Multipart dở" stat card area is read-only; add a cleanup button. In the Global aliases card (admin section), after the add-global-alias group, add a local-alias group:
```tsx
        {isAdmin && (
          <Group mt="sm">
            <TextInput placeholder="local alias" value={localAlias} onChange={(e) => setLocalAlias(e.currentTarget.value)} />
            <Select placeholder="key" w={220} data={bucket.keys.map((k) => ({ value: k.accessKeyId, label: k.name || k.accessKeyId }))} value={localKey} onChange={setLocalKey} />
            <Button variant="light" onClick={() => localAliasMut.mutate()} disabled={!localAlias || !localKey}>Thêm local alias</Button>
          </Group>
        )}
```
(Import `Select` from '@mantine/core' — add to the existing import.)
(e) Add a CORS card before the "Quyền key trên bucket" card:
```tsx
      <Card withBorder>
        <Title order={5} mb="sm">CORS rules (JSON)</Title>
        <Textarea value={corsText} onChange={(e) => setCorsText(e.currentTarget.value)} minRows={4} autosize disabled={!isAdmin} styles={{ input: { fontFamily: 'monospace' } }} />
        {isAdmin && <Button mt="sm" w={140} onClick={() => corsMut.mutate()} loading={corsMut.isPending}>Lưu CORS</Button>}
      </Card>
```
(Import `Textarea` from '@mantine/core' — add to the existing import.)
(f) Add a cleanup-uploads button: in the stat grid, the multipart card stays; under the Quota card or near website, add (admin only):
```tsx
      {isAdmin && (
        <Group>
          <Button variant="light" color="orange" onClick={() => cleanupMut.mutate()} loading={cleanupMut.isPending}>Dọn multipart upload dở (&gt;24h)</Button>
        </Group>
      )}
```

- [ ] **Step 3: `KeysPage.tsx`** — add an optional expiration to the create modal.

Add state: `const [expiration, setExpiration] = useState('')`. In the create mutation, send it:
```tsx
    mutationFn: async (n: string) => (await api.post<KeyInfo>('/keys', { name: n, expiration: expiration ? new Date(expiration).toISOString() : null })).data,
```
In the create Modal, add under the name input:
```tsx
          <TextInput label="Hết hạn (trống = không hết hạn)" type="datetime-local" value={expiration} onChange={(e) => setExpiration(e.currentTarget.value)} />
```
Reset it in `onSuccess` (`setExpiration('')`).

- [ ] **Step 4: `KeyDetailPage.tsx`** — add expiration display + edit.

Show the current expiration and add controls to set/clear it. After the createBucket Switch, add:
```tsx
          <Group align="end">
            <TextInput label="Hết hạn" type="datetime-local" value={expiry} onChange={(e) => setExpiry(e.currentTarget.value)} disabled={!isAdmin} />
            {isAdmin && <Button variant="light" onClick={() => updateMut.mutate({ expiration: new Date(expiry).toISOString() })} disabled={!expiry}>Đặt hạn</Button>}
            {isAdmin && <Button variant="subtle" onClick={() => updateMut.mutate({ never_expires: true })}>Bỏ hạn</Button>}
          </Group>
```
Add state `const [expiry, setExpiry] = useState('')` and seed it in the existing `useEffect`:
```tsx
      setExpiry(key.expiration ? key.expiration.slice(0, 16) : '')
```
(`TextInput`, `Group`, `Button` are already imported.)

- [ ] **Step 5: `AdminTokensPage.tsx`** — add an Edit action (uses the existing `POST /api/admin-tokens/{id}`).

Add an edit modal + state and an edit ActionIcon per non-config-file token row:
```tsx
  const [editFor, setEditFor] = useState<AdminToken | null>(null)
  const [editName, setEditName] = useState('')
  const [editScope, setEditScope] = useState('')
  const editMut = useMutation({
    mutationFn: async () => (await api.post(`/admin-tokens/${editFor!.id}`, { name: editName, scope: editScope.split(',').map((s) => s.trim()).filter(Boolean) })).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-tokens'] }); setEditFor(null); notifications.show({ color: 'green', message: 'Đã cập nhật token' }) },
    onError: (e: any) => notifications.show({ color: 'red', message: e?.response?.data?.error || 'Cập nhật thất bại' }),
  })
  function openEdit(t: AdminToken) { setEditFor(t); setEditName(t.name); setEditScope(t.scope.join(', ')) }
```
In the actions cell (where delete is), before the delete icon, add (only when `t.id !== null`):
```tsx
                    <ActionIcon variant="subtle" aria-label="edit" onClick={() => openEdit(t)}><IconPencil size={16} /></ActionIcon>
```
(Import `IconPencil` from '@tabler/icons-react'.) Add the edit modal at the end (near the other modals):
```tsx
      <Modal opened={editFor != null} onClose={() => setEditFor(null)} title="Sửa token">
        <Stack>
          <TextInput label="Tên" value={editName} onChange={(e) => setEditName(e.currentTarget.value)} />
          <TextInput label="Scope (phẩy)" value={editScope} onChange={(e) => setEditScope(e.currentTarget.value)} />
          <Button onClick={() => editMut.mutate()} loading={editMut.isPending}>Lưu</Button>
        </Stack>
      </Modal>
```

- [ ] **Step 6: Build + rebuild binary**

```bash
cd /Users/hunghd/Repositories/garage-admin/src/web && npm run build
cd /Users/hunghd/Repositories/garage-admin/src && go build ./... && go test ./...
```
Fix any TS errors minimally (unused imports; `IconPencil` should exist — if not use `IconEdit`). Confirm dist rebuilt.

- [ ] **Step 7: Commit**

```
cd /Users/hunghd/Repositories/garage-admin
git add src/web/src src/internal/web/dist
git commit -m "feat: UI for local aliases, CORS, cleanup uploads, key expiration, admin-token edit"
```

---

## Task 5: Frontend — Node Maintenance: worker info, worker variable, block info

**Files:** MODIFY `src/web/src/pages/NodeMaintenancePage.tsx`.

Wire the existing `/api/nodes/workers/info`, `/api/nodes/workers/variable` (GET), `/api/nodes/blocks/info` endpoints.

- [ ] **Step 1: Add a worker-detail modal (click a worker row → GetWorkerInfo) and a block-info lookup.**

(a) Add state:
```tsx
  const [workerDetail, setWorkerDetail] = useState<unknown>(null)
  const [blockHash, setBlockHash] = useState('')
  const [blockInfo, setBlockInfo] = useState<unknown>(null)
```
(b) Add handlers (use the `mutate`-style direct calls):
```tsx
  async function showWorker(wid: number) {
    try {
      const data = (await api.post('/nodes/workers/info', { id: wid }, { params: { node } })).data
      setWorkerDetail(data)
    } catch (e: any) { notifications.show({ color: 'red', message: e?.response?.data?.error || 'Lỗi' }) }
  }
  async function lookupBlock() {
    try {
      const data = (await api.post('/nodes/blocks/info', { block_hash: blockHash }, { params: { node } })).data
      setBlockInfo(data)
    } catch (e: any) { notifications.show({ color: 'red', message: e?.response?.data?.error || 'Lỗi' }) }
  }
```
(c) Make worker rows clickable — in the workers table body, wrap the worker name cell in a clickable Anchor:
```tsx
                <Table.Td><Anchor onClick={() => showWorker(wk.id)}>{wk.name}</Anchor></Table.Td>
```
(replace the plain `<Table.Td>{wk.name}</Table.Td>`). Import `Anchor` from '@mantine/core'.
(d) Add a "Block info" lookup card (after the block errors card):
```tsx
      <Card withBorder>
        <Title order={5} mb="sm">Tra cứu block</Title>
        <Group align="end">
          <TextInput label="Block hash" value={blockHash} onChange={(e) => setBlockHash(e.currentTarget.value)} w={360} />
          <Button variant="light" onClick={lookupBlock} disabled={!blockHash}>Tra cứu</Button>
        </Group>
        {blockInfo != null && <Code block mt="sm">{JSON.stringify(blockInfo, null, 2)}</Code>}
      </Card>
```
(e) Add the worker-detail modal near the existing confirm modal:
```tsx
      <Modal opened={workerDetail != null} onClose={() => setWorkerDetail(null)} title="Chi tiết worker" size="lg">
        <Code block>{JSON.stringify(workerDetail, null, 2)}</Code>
      </Modal>
```

- [ ] **Step 2: Build + rebuild binary**

```bash
cd /Users/hunghd/Repositories/garage-admin/src/web && npm run build
cd /Users/hunghd/Repositories/garage-admin/src && go build ./...
```
Fix any TS errors minimally. Confirm dist rebuilt.

- [ ] **Step 3: Commit**

```
cd /Users/hunghd/Repositories/garage-admin
git add src/web/src src/internal/web/dist
git commit -m "feat: wire worker-info, block-info lookups into Node Maintenance"
```

---

## Task 6: Verify end-to-end (controller)

Start the binary, seed the cluster (with S3 creds for inspect), Playwright MCP verify (read-only where possible):
- Bucket detail: CORS card shows `[]`; local-alias form present; cleanup-uploads button present (don't trigger destructively unless safe — cleanup with 24h threshold on the empty bucket is harmless). InspectObject via Files page on a temp object (upload → inspect → shows versions JSON → delete).
- Keys: create modal shows expiration field; key detail shows expiration controls.
- Admin Tokens: edit pencil on non-config tokens (config-file tokens have id=null → no edit).
- Node Maintenance: click a worker name → detail modal with JSON; block lookup card present.

Clean up any temp objects. No code changes expected.

---

## Self-Review

**Spec coverage (Phase 7 = remaining Admin API gaps):**
- CleanupIncompleteUploads → Tasks 1,3,4. ✓
- InspectObject → Tasks 1,3,4 (Files page). ✓
- Local aliases (add/remove) → Tasks 1,3,4. ✓
- CORS rules (get via BucketInfo passthrough + set via UpdateBucket) → Tasks 1,3,4. ✓
- Key expiration (create + update) → Tasks 2,3,4. ✓
- UpdateAdminToken UI → Task 4. ✓
- GetWorkerInfo / GetBlockInfo UI (GetWorkerVariable endpoint already exists; worker variable *set* shipped in Phase 4b) → Task 5. ✓

**Placeholder scan:** No TBD/TODO; all code complete. CORS rule inner shape is intentionally passed through as raw JSON (`cors_rules` array) so the exact Garage field names never need to be hardcoded; the textarea is seeded from the bucket's current `corsRules`.

**Type consistency:** client `KeyCreateRequest`/`UpdateKeyRequest` (with Expiration/NeverExpires) used by api keys handlers; `UpdateBucketRequest.CorsRules *json.RawMessage` passed through. API request bodies snake_case (`older_than_secs`, `access_key_id`, `cors_rules`, `never_expires`); the client maps to Garage camelCase / passthrough. Frontend posts matching snake_case. The CreateKey signature change is contained: only `api/keys.go` calls it (updated) and the garage test (updated).

**Safety:** new mutations (cleanup-uploads, local alias add, CORS save, key expiration, admin-token edit) are admin-only (`RequireAdmin`); inspect/block-info are reads (auth). Cleanup uses a 24h threshold so it never deletes in-progress uploads younger than a day. Live verification avoids destructive actions except a self-contained temp-object inspect.
