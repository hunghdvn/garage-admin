# Phase 4a — Admin Tokens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Manage Garage **admin tokens** from the panel — list all tokens (including read-only config-file tokens), show the current token, create a token (revealing its secret once), update a token's name/scope/expiration, and delete a token.

**Architecture:** Extend the Garage Admin API v2 client (`internal/garage`) with admin-token operations, add `internal/api` handlers under `/api/admin-tokens` (reads: auth; mutations: admin-only) routed to the selected cluster via `garageClientForRequest`, and add a React `AdminTokensPage` + nav link. Read paths verified live against Garage v2.3.0; create/update/delete are covered by mock tests and left for the user to exercise (creating a token mints a real credential).

**Tech stack:** Same as Phases 1–3. No new dependencies.

**Branch:** `phase4-node-block-tokens` (off `phase3-cluster-layout`). Module root `src/`; run `go` from `src/`.

**Verified API contract (Garage v2.3.0):**
- `GET /v2/ListAdminTokens` → `[{id, created, name, expiration, expired, scope[]}]` (config-file tokens have `id:null`, `created:null`)
- `GET /v2/GetCurrentAdminTokenInfo` → `{id, created, name, expiration, expired, scope[]}`
- `GET /v2/GetAdminTokenInfo?id=<id>` (or `?search=`) → token info
- `POST /v2/CreateAdminToken` body `{name, scope[], expiration|null, neverExpires?}` → token info **plus `secretToken` (shown once)**
- `POST /v2/UpdateAdminToken?id=<id>` body `{name?, scope?, expiration?, neverExpires?}` → token info
- `POST /v2/DeleteAdminToken?id=<id>` → (empty)

Scope values are endpoint-group names or `"*"` (full access); e.g. `["*"]`, `["Metrics"]`.

---

## File Structure

```
src/internal/garage/admintokens.go        # NEW client methods (+ admintokens_test.go)
src/internal/api/admintokens.go            # NEW handlers /api/admin-tokens/* (+ admintokens_test.go)
src/internal/api/server.go                 # MODIFY: mount admin-tokens
src/web/src/api/client.ts                  # MODIFY: add AdminToken types
src/web/src/pages/AdminTokensPage.tsx       # NEW
src/web/src/components/AppShell.tsx         # MODIFY: nav link
src/web/src/App.tsx                         # MODIFY: route
```

---

## Task 1: Garage client — admin token operations

**Files:** Create `src/internal/garage/admintokens.go`, `src/internal/garage/admintokens_test.go`

- [ ] **Step 1: Write `src/internal/garage/admintokens_test.go`**

```go
package garage

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestListAdminTokens(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v2/ListAdminTokens" {
			t.Errorf("path=%q", r.URL.Path)
		}
		w.Write([]byte(`[{"id":null,"created":null,"name":"cfg","expiration":null,"expired":false,"scope":["*"]},{"id":"tok1","created":"x","name":"app","expiration":null,"expired":false,"scope":["Metrics"]}]`))
	}))
	defer srv.Close()
	got, err := New(srv.URL, "t").ListAdminTokens()
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].ID != nil || got[1].ID == nil || *got[1].ID != "tok1" {
		t.Errorf("got %+v", got)
	}
}

func TestGetCurrentAdminTokenInfo(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v2/GetCurrentAdminTokenInfo" {
			t.Errorf("path=%q", r.URL.Path)
		}
		w.Write([]byte(`{"id":null,"created":null,"name":"cfg","expiration":null,"expired":false,"scope":["*"]}`))
	}))
	defer srv.Close()
	got, err := New(srv.URL, "t").GetCurrentAdminTokenInfo()
	if err != nil {
		t.Fatal(err)
	}
	if got.Name != "cfg" || len(got.Scope) != 1 || got.Scope[0] != "*" {
		t.Errorf("got %+v", got)
	}
}

func TestCreateAdminTokenReturnsSecret(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v2/CreateAdminToken" || r.Method != http.MethodPost {
			t.Errorf("path=%q method=%q", r.URL.Path, r.Method)
		}
		var body AdminTokenRequest
		b, _ := io.ReadAll(r.Body)
		json.Unmarshal(b, &body)
		if body.Name != "app" || len(body.Scope) != 1 || body.Scope[0] != "*" {
			t.Errorf("body=%+v", body)
		}
		w.Write([]byte(`{"id":"tok9","created":"x","name":"app","expiration":null,"expired":false,"scope":["*"],"secretToken":"SECRET-TOKEN-ONCE"}`))
	}))
	defer srv.Close()
	got, err := New(srv.URL, "t").CreateAdminToken(AdminTokenRequest{Name: "app", Scope: []string{"*"}, NeverExpires: true})
	if err != nil {
		t.Fatal(err)
	}
	if got.SecretToken == nil || *got.SecretToken != "SECRET-TOKEN-ONCE" || got.ID == nil || *got.ID != "tok9" {
		t.Errorf("got %+v", got)
	}
}

func TestUpdateAndDeleteAdminToken(t *testing.T) {
	var paths []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path+"?"+r.URL.RawQuery)
		w.Write([]byte(`{"id":"tok1","created":"x","name":"renamed","expiration":null,"expired":false,"scope":["*"]}`))
	}))
	defer srv.Close()
	c := New(srv.URL, "t")
	name := "renamed"
	if _, err := c.UpdateAdminToken("tok1", AdminTokenRequest{Name: name, Scope: []string{"*"}, NeverExpires: true}); err != nil {
		t.Fatal(err)
	}
	if err := c.DeleteAdminToken("tok1"); err != nil {
		t.Fatal(err)
	}
	if paths[0] != "/v2/UpdateAdminToken?id=tok1" || paths[1] != "/v2/DeleteAdminToken?id=tok1" {
		t.Errorf("paths=%v", paths)
	}
}
```

- [ ] **Step 2: Run `go test ./internal/garage/ -run AdminToken` — confirm FAIL.**

- [ ] **Step 3: Write `src/internal/garage/admintokens.go`**

```go
package garage

import (
	"context"
	"net/http"
	"net/url"
)

// AdminTokenInfo is an admin token as returned by the list/get/current endpoints.
// ID and Created are null for tokens defined in the daemon configuration file.
type AdminTokenInfo struct {
	ID          *string  `json:"id"`
	Created     *string  `json:"created"`
	Name        string   `json:"name"`
	Expiration  *string  `json:"expiration"`
	Expired     bool     `json:"expired"`
	Scope       []string `json:"scope"`
	SecretToken *string  `json:"secretToken,omitempty"` // only present on create
}

// AdminTokenRequest is the body for CreateAdminToken / UpdateAdminToken.
type AdminTokenRequest struct {
	Name         string   `json:"name"`
	Scope        []string `json:"scope"`
	Expiration   *string  `json:"expiration"`
	NeverExpires bool     `json:"neverExpires"`
}

// ListAdminTokens calls GET /v2/ListAdminTokens.
func (c *Client) ListAdminTokens() ([]AdminTokenInfo, error) {
	var out []AdminTokenInfo
	err := c.do(context.Background(), http.MethodGet, "/v2/ListAdminTokens", nil, &out)
	return out, err
}

// GetCurrentAdminTokenInfo calls GET /v2/GetCurrentAdminTokenInfo.
func (c *Client) GetCurrentAdminTokenInfo() (*AdminTokenInfo, error) {
	var out AdminTokenInfo
	err := c.do(context.Background(), http.MethodGet, "/v2/GetCurrentAdminTokenInfo", nil, &out)
	return &out, err
}

// GetAdminTokenInfo calls GET /v2/GetAdminTokenInfo?id=.
func (c *Client) GetAdminTokenInfo(id string) (*AdminTokenInfo, error) {
	var out AdminTokenInfo
	err := c.do(context.Background(), http.MethodGet, "/v2/GetAdminTokenInfo?id="+url.QueryEscape(id), nil, &out)
	return &out, err
}

// CreateAdminToken calls POST /v2/CreateAdminToken. The response includes secretToken once.
func (c *Client) CreateAdminToken(req AdminTokenRequest) (*AdminTokenInfo, error) {
	var out AdminTokenInfo
	err := c.do(context.Background(), http.MethodPost, "/v2/CreateAdminToken", req, &out)
	return &out, err
}

// UpdateAdminToken calls POST /v2/UpdateAdminToken?id=.
func (c *Client) UpdateAdminToken(id string, req AdminTokenRequest) (*AdminTokenInfo, error) {
	var out AdminTokenInfo
	err := c.do(context.Background(), http.MethodPost, "/v2/UpdateAdminToken?id="+url.QueryEscape(id), req, &out)
	return &out, err
}

// DeleteAdminToken calls POST /v2/DeleteAdminToken?id=.
func (c *Client) DeleteAdminToken(id string) error {
	return c.do(context.Background(), http.MethodPost, "/v2/DeleteAdminToken?id="+url.QueryEscape(id), nil, nil)
}
```

- [ ] **Step 4: Run `go test ./internal/garage/` — confirm PASS (all).**

- [ ] **Step 5: Commit**

```
git add src/internal/garage/admintokens.go src/internal/garage/admintokens_test.go
git commit -m "feat: add Garage client admin token operations"
```

---

## Task 2: API handlers — admin tokens

**Files:** Create `src/internal/api/admintokens.go`, `src/internal/api/admintokens_test.go`; MODIFY `src/internal/api/server.go`.

- [ ] **Step 1: Modify `src/internal/api/server.go` — register the route.**

In `Routes()`, inside the `/api` group, add after `s.mountKeys(r)`:
```go
		s.mountAdminTokens(r)
```

- [ ] **Step 2: Write `src/internal/api/admintokens_test.go`**

```go
package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestListAdminTokensProxy(t *testing.T) {
	r, cookie := newGarageBackedAPI(t, "readonly", func(w http.ResponseWriter, req *http.Request) {
		if req.URL.Path == "/v2/GetCurrentAdminTokenInfo" {
			w.Write([]byte(`{"id":null,"created":null,"name":"cfg","expiration":null,"expired":false,"scope":["*"]}`))
			return
		}
		w.Write([]byte(`[{"id":"tok1","created":"x","name":"app","expiration":null,"expired":false,"scope":["*"]}]`))
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/api/admin-tokens", nil)
	req.AddCookie(cookie)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "tok1") {
		t.Fatalf("code=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestCreateAdminTokenRequiresAdminAndReturnsSecret(t *testing.T) {
	rRO, cRO := newGarageBackedAPI(t, "readonly", func(w http.ResponseWriter, _ *http.Request) {})
	recRO := httptest.NewRecorder()
	reqRO := httptest.NewRequest("POST", "/api/admin-tokens", strings.NewReader(`{"name":"x","scope":["*"]}`))
	reqRO.AddCookie(cRO)
	rRO.ServeHTTP(recRO, reqRO)
	if recRO.Code != http.StatusForbidden {
		t.Fatalf("readonly create code=%d want 403", recRO.Code)
	}

	r, cookie := newGarageBackedAPI(t, "admin", func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`{"id":"tok9","created":"x","name":"x","expiration":null,"expired":false,"scope":["*"],"secretToken":"SECRET"}`))
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/admin-tokens", strings.NewReader(`{"name":"x","scope":["*"]}`))
	req.AddCookie(cookie)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated || !strings.Contains(rec.Body.String(), "SECRET") {
		t.Fatalf("code=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestDeleteAdminTokenProxiesID(t *testing.T) {
	var gotQuery string
	r, cookie := newGarageBackedAPI(t, "admin", func(w http.ResponseWriter, req *http.Request) {
		if req.URL.Path == "/v2/DeleteAdminToken" {
			gotQuery = req.URL.RawQuery
		}
		w.WriteHeader(http.StatusOK)
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("DELETE", "/api/admin-tokens/tok1", nil)
	req.AddCookie(cookie)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || gotQuery != "id=tok1" {
		t.Fatalf("code=%d query=%q", rec.Code, gotQuery)
	}
}
```

- [ ] **Step 3: Run `go test ./internal/api/ -run AdminToken` — confirm FAIL.**

- [ ] **Step 4: Write `src/internal/api/admintokens.go`**

```go
package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/HungHD/garage-admin/internal/garage"
)

func (s *Server) mountAdminTokens(r chi.Router) {
	r.Route("/admin-tokens", func(r chi.Router) {
		r.Use(s.Auth.RequireAuth)
		r.Get("/", s.handleListAdminTokens)
		r.Get("/current", s.handleCurrentAdminToken)
		r.With(s.Auth.RequireAdmin).Post("/", s.handleCreateAdminToken)
		r.With(s.Auth.RequireAdmin).Post("/{id}", s.handleUpdateAdminToken)
		r.With(s.Auth.RequireAdmin).Delete("/{id}", s.handleDeleteAdminToken)
	})
}

func (s *Server) handleListAdminTokens(w http.ResponseWriter, r *http.Request) {
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	list, err := client.ListAdminTokens()
	if err != nil {
		writeGarageError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (s *Server) handleCurrentAdminToken(w http.ResponseWriter, r *http.Request) {
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	info, err := client.GetCurrentAdminTokenInfo()
	if err != nil {
		writeGarageError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, info)
}

func (s *Server) adminTokenReqFromBody(r *http.Request) (garage.AdminTokenRequest, error) {
	var body struct {
		Name       string   `json:"name"`
		Scope      []string `json:"scope"`
		Expiration *string  `json:"expiration"`
	}
	if err := decodeJSON(r, &body); err != nil {
		return garage.AdminTokenRequest{}, err
	}
	scope := body.Scope
	if scope == nil {
		scope = []string{}
	}
	return garage.AdminTokenRequest{
		Name:         body.Name,
		Scope:        scope,
		Expiration:   body.Expiration,
		NeverExpires: body.Expiration == nil,
	}, nil
}

func (s *Server) handleCreateAdminToken(w http.ResponseWriter, r *http.Request) {
	req, err := s.adminTokenReqFromBody(r)
	if err != nil || req.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	info, err := client.CreateAdminToken(req)
	if err != nil {
		writeGarageError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, info)
}

func (s *Server) handleUpdateAdminToken(w http.ResponseWriter, r *http.Request) {
	req, err := s.adminTokenReqFromBody(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	info, err := client.UpdateAdminToken(chi.URLParam(r, "id"), req)
	if err != nil {
		writeGarageError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, info)
}

func (s *Server) handleDeleteAdminToken(w http.ResponseWriter, r *http.Request) {
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	if err := client.DeleteAdminToken(chi.URLParam(r, "id")); err != nil {
		writeGarageError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
```

- [ ] **Step 5: Run `go test ./...` (from src/) — confirm all PASS. `go vet ./...`.**

- [ ] **Step 6: Commit**

```
git add src/internal/api/admintokens.go src/internal/api/admintokens_test.go src/internal/api/server.go
git commit -m "feat: add admin token management API handlers"
```

---

## Task 3: Frontend — Admin Tokens page

**Files:** MODIFY `src/web/src/api/client.ts`; create `src/web/src/pages/AdminTokensPage.tsx`; MODIFY `src/web/src/components/AppShell.tsx`, `src/web/src/App.tsx`.

- [ ] **Step 1: Append types to `src/web/src/api/client.ts`**

```ts
export interface AdminToken {
  id: string | null
  created: string | null
  name: string
  expiration: string | null
  expired: boolean
  scope: string[]
  secretToken?: string
}
```

- [ ] **Step 2: Create `src/web/src/pages/AdminTokensPage.tsx`**

```tsx
import { useState } from 'react'
import {
  ActionIcon, Alert, Badge, Button, Card, Code, CopyButton, Group, Modal, Stack, Table, Text, TextInput, Title,
} from '@mantine/core'
import { IconPlus, IconTrash, IconCopy, IconCheck } from '@tabler/icons-react'
import { useDisclosure } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type AdminToken } from '../api/client'
import { useAuth } from '../auth/AuthContext'

export function AdminTokensPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const qc = useQueryClient()
  const [opened, { open, close }] = useDisclosure(false)
  const [name, setName] = useState('')
  const [scope, setScope] = useState('*')
  const [expiration, setExpiration] = useState('')
  const [created, setCreated] = useState<AdminToken | null>(null)

  const { data: tokens } = useQuery({
    queryKey: ['admin-tokens'],
    queryFn: async () => (await api.get<AdminToken[]>('/admin-tokens')).data,
  })

  const createMut = useMutation({
    mutationFn: async () => (await api.post<AdminToken>('/admin-tokens', {
      name,
      scope: scope.split(',').map((s) => s.trim()).filter(Boolean),
      expiration: expiration ? new Date(expiration).toISOString() : null,
    })).data,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['admin-tokens'] })
      close(); setName(''); setScope('*'); setExpiration('')
      setCreated(data)
    },
    onError: (e: any) => notifications.show({ color: 'red', message: e?.response?.data?.error || 'Tạo token thất bại' }),
  })

  const deleteMut = useMutation({
    mutationFn: async (id: string) => api.delete(`/admin-tokens/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-tokens'] }); notifications.show({ color: 'green', message: 'Đã xóa token' }) },
    onError: (e: any) => notifications.show({ color: 'red', message: e?.response?.data?.error || 'Xóa thất bại' }),
  })

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={3}>Admin Tokens</Title>
        {isAdmin && <Button leftSection={<IconPlus size={16} />} onClick={open}>Tạo token</Button>}
      </Group>

      <Card withBorder>
        <Table highlightOnHover>
          <Table.Thead>
            <Table.Tr><Table.Th>Tên</Table.Th><Table.Th>Scope</Table.Th><Table.Th>Hết hạn</Table.Th><Table.Th>Trạng thái</Table.Th><Table.Th /></Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {tokens?.map((t, i) => (
              <Table.Tr key={t.id ?? `cfg-${i}`}>
                <Table.Td>{t.name}</Table.Td>
                <Table.Td>{t.scope.map((s) => <Badge key={s} variant="light" mr={4}>{s}</Badge>)}</Table.Td>
                <Table.Td>{t.expiration ? new Date(t.expiration).toLocaleString() : '∞'}</Table.Td>
                <Table.Td>
                  {t.id === null ? <Badge color="gray">config file</Badge>
                    : t.expired ? <Badge color="red">expired</Badge> : <Badge color="green">active</Badge>}
                </Table.Td>
                <Table.Td>
                  {isAdmin && t.id !== null && (
                    <ActionIcon color="red" variant="subtle" aria-label="delete" onClick={() => deleteMut.mutate(t.id!)}>
                      <IconTrash size={16} />
                    </ActionIcon>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>

      <Modal opened={opened} onClose={close} title="Tạo admin token">
        <Stack>
          <TextInput label="Tên" value={name} onChange={(e) => setName(e.currentTarget.value)} required />
          <TextInput label="Scope (phẩy)" value={scope} onChange={(e) => setScope(e.currentTarget.value)}
            description={'"*" = toàn quyền; hoặc liệt kê nhóm endpoint, vd: Metrics'} />
          <TextInput label="Hết hạn (trống = không hết hạn)" type="datetime-local" value={expiration} onChange={(e) => setExpiration(e.currentTarget.value)} />
          <Button onClick={() => createMut.mutate()} loading={createMut.isPending} disabled={!name}>Tạo</Button>
        </Stack>
      </Modal>

      <Modal opened={created != null} onClose={() => setCreated(null)} title="Token đã tạo — lưu ngay!" size="lg">
        {created && (
          <Stack>
            <Alert color="yellow">Secret token chỉ hiển thị MỘT LẦN. Sao chép và lưu lại an toàn.</Alert>
            <Text size="sm">Token</Text>
            <Group>
              <Code>{created.secretToken}</Code>
              <CopyButton value={created.secretToken ?? ''}>
                {({ copied, copy }) => (
                  <ActionIcon variant="light" onClick={copy} aria-label="copy">
                    {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                  </ActionIcon>
                )}
              </CopyButton>
            </Group>
            <Button onClick={() => setCreated(null)}>Đã lưu, đóng</Button>
          </Stack>
        )}
      </Modal>
    </Stack>
  )
}
```

- [ ] **Step 3: Add nav link in `src/web/src/components/AppShell.tsx`**

Add `IconKey2` to the `@tabler/icons-react` import (or reuse an existing icon; use `IconKey2`), and add a nav link after the "Cluster" link and before "Settings":
```tsx
        <NavLink component={Link} to="/admin-tokens" label="Admin Tokens" active={loc.pathname.startsWith('/admin-tokens')} leftSection={<IconKey2 size={18} />} />
```

- [ ] **Step 4: Add route in `src/web/src/App.tsx`**

Add `import { AdminTokensPage } from './pages/AdminTokensPage'` and a route inside the authenticated `<Routes>`:
```tsx
        <Route path="/admin-tokens" element={<AdminTokensPage />} />
```

- [ ] **Step 5: Build + rebuild binary**

```bash
cd /Users/hunghd/Repositories/garage-admin/src/web && npm run build
cd /Users/hunghd/Repositories/garage-admin/src && go build ./... && go test ./...
```
Fix any TS errors minimally. Confirm dist rebuilt and Go tests pass.

- [ ] **Step 6: Commit**

```
cd /Users/hunghd/Repositories/garage-admin
git add src/web/src src/internal/web/dist
git commit -m "feat: add Admin Tokens page"
```

---

## Task 4: Verify end-to-end (controller)

Start the binary, seed the real cluster, use Playwright MCP to verify:
- Admin Tokens page lists the two config-file tokens (`admin_token`, `metrics_token`) with `config file` badge and no delete button (id is null).
- Create modal renders. (Creating a real token mints a credential on the shared cluster — only do this if the user approves; otherwise verify the list + modal render only.)

No code changes expected.

---

## Self-Review

**Spec coverage (Phase 4a = Admin Tokens from the design spec):**
- List/current/get → Tasks 1, 2, 3. ✓
- Create (secret shown once) → Tasks 1, 2, 3. ✓
- Update (name/scope/expiration) → Tasks 1, 2 (handler), client. ✓ (UI exposes create+delete; update wired in client/API for completeness)
- Delete → Tasks 1, 2, 3. ✓
- Config-file tokens read-only (id null → no delete) → Task 3. ✓
- Reads auth, mutations admin (frontend + backend RequireAdmin) → Tasks 2, 3. ✓

**Placeholder scan:** No TBD/TODO; all code complete.

**Type consistency:** `garage.AdminTokenInfo` / `AdminTokenRequest` consistent across `garage` and `api`. API uses `writeGarageError` (Phase 3) so Garage 4xx propagate. Frontend `AdminToken` type matches the passthrough JSON (camelCase, `id` nullable, optional `secretToken`). Snake_case is not needed here since the create/update body fields (`name`, `scope`, `expiration`) are the same in JSON.

**Note:** UpdateAdminToken is implemented in client + API (`POST /api/admin-tokens/{id}`) but the Phase 4a UI only surfaces create + delete to keep the page focused; an inline edit can be added later. This is intentional minimalism, not a gap in the API surface.
