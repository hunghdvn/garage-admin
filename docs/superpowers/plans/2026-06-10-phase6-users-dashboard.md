# Phase 6 — User Management + Dashboard + Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Admin user management (list/create/change-role/reset-password/delete with last-admin & self guards), a self-service "change my password" profile, and an enriched dashboard (cluster status + storage + bucket/key/object counts + quick links). This is the final foundation phase.

**Architecture:** Add SQLite user-mutation methods (`UpdateUserRole`, `UpdateUserPassword`, `CountAdmins`) to `internal/db`; add `/api/users` admin handlers and a `/api/auth/password` self-service handler in `internal/api`; enrich the React `DashboardPage` and add `UsersPage` + `ProfilePage`, with a header user menu. No Garage API changes. All user data is local (SQLite); the dashboard reuses existing `/api/cluster/*`, `/api/buckets`, `/api/keys`.

**Tech stack:** Same as prior phases. No new dependencies.

**Branch:** `phase6-users-dashboard` (off `phase5-file-browser`). Module root `src/`; run `go` from `src/`.

---

## File Structure

```
src/internal/db/users.go            # MODIFY: UpdateUserRole, UpdateUserPassword, CountAdmins (+ users_test.go)
src/internal/api/users.go           # NEW: /api/users/* handlers (+ users_test.go)
src/internal/api/auth.go            # MODIFY: add POST /auth/password (change own password)
src/internal/api/server.go          # MODIFY: mount users
src/web/src/api/client.ts           # MODIFY: add AdminUser type
src/web/src/pages/UsersPage.tsx      # NEW
src/web/src/pages/ProfilePage.tsx    # NEW
src/web/src/pages/DashboardPage.tsx  # MODIFY: enrich
src/web/src/components/AppShell.tsx  # MODIFY: user menu + Users nav link
src/web/src/App.tsx                  # MODIFY: routes
```

---

## Task 1: DB — user mutation methods

**Files:** MODIFY `src/internal/db/users.go`; create/append `src/internal/db/users_extra_test.go`

- [ ] **Step 1: Append tests to a new file `src/internal/db/users_extra_test.go`**

```go
package db

import "testing"

func TestUpdateUserRoleAndPassword(t *testing.T) {
	d := newTestDB(t)
	u, _ := d.CreateUser("alice", "h1", "readonly")

	if err := d.UpdateUserRole(u.ID, "admin"); err != nil {
		t.Fatal(err)
	}
	if err := d.UpdateUserPassword(u.ID, "h2"); err != nil {
		t.Fatal(err)
	}
	got, _ := d.GetUserByID(u.ID)
	if got.Role != "admin" || got.PasswordHash != "h2" {
		t.Errorf("got %+v", got)
	}
}

func TestCountAdmins(t *testing.T) {
	d := newTestDB(t)
	d.CreateUser("a", "h", "admin")
	d.CreateUser("b", "h", "readonly")
	d.CreateUser("c", "h", "admin")
	n, err := d.CountAdmins()
	if err != nil || n != 2 {
		t.Fatalf("CountAdmins = %d, %v; want 2", n, err)
	}
}
```

- [ ] **Step 2: Run `go test ./internal/db/ -run 'UpdateUser|CountAdmins'` — confirm FAIL.**

- [ ] **Step 3: Append to `src/internal/db/users.go`**

```go
// UpdateUserRole sets a user's role.
func (d *DB) UpdateUserRole(id int64, role string) error {
	_, err := d.sql.Exec(`UPDATE users SET role=?, updated_at=? WHERE id=?`, role, nowRFC3339(), id)
	return err
}

// UpdateUserPassword sets a user's password hash.
func (d *DB) UpdateUserPassword(id int64, passwordHash string) error {
	_, err := d.sql.Exec(`UPDATE users SET password_hash=?, updated_at=? WHERE id=?`, passwordHash, nowRFC3339(), id)
	return err
}

// CountAdmins returns the number of users with the admin role.
func (d *DB) CountAdmins() (int, error) {
	var n int
	err := d.sql.QueryRow(`SELECT COUNT(*) FROM users WHERE role='admin'`).Scan(&n)
	return n, err
}
```

- [ ] **Step 4: Run `go test ./internal/db/` — confirm PASS.**

- [ ] **Step 5: Commit**

```
git add src/internal/db/users.go src/internal/db/users_extra_test.go
git commit -m "feat: add user role/password update and admin count"
```

---

## Task 2: API — user management + change-password

**Files:** Create `src/internal/api/users.go`, `src/internal/api/users_test.go`; MODIFY `src/internal/api/auth.go`, `src/internal/api/server.go`.

Guards: cannot delete yourself; cannot delete or demote the last remaining admin.

- [ ] **Step 1: Mount routes — modify `src/internal/api/server.go`.**

In `Routes()` inside the `/api` group, after `s.mountFiles(r)` add:
```go
		s.mountUsers(r)
```

- [ ] **Step 2: Add change-password route — modify `src/internal/api/auth.go`.**

In `mountAuth`, add a route (authenticated):
```go
	r.With(s.Auth.RequireAuth).Post("/auth/password", s.handleChangePassword)
```
And add the handler at the end of `auth.go`:
```go
func (s *Server) handleChangePassword(w http.ResponseWriter, r *http.Request) {
	var body struct {
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
	}
	if err := decodeJSON(r, &body); err != nil || body.NewPassword == "" {
		writeError(w, http.StatusBadRequest, "new_password is required")
		return
	}
	u := auth.UserFromContext(r.Context())
	if u == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	if !auth.VerifyPassword(u.PasswordHash, body.CurrentPassword) {
		writeError(w, http.StatusBadRequest, "mật khẩu hiện tại không đúng")
		return
	}
	hash, err := auth.HashPassword(body.NewPassword)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "hash failed")
		return
	}
	if err := s.DB.UpdateUserPassword(u.ID, hash); err != nil {
		writeError(w, http.StatusInternalServerError, "update failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
```
(`auth` and `db` are already imported in auth.go.)

- [ ] **Step 3: Write `src/internal/api/users_test.go`**

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

func newUsersAPI(t *testing.T, role string) (*Server, *http.Cookie, *db.User) {
	t.Helper()
	d, err := db.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	hash, _ := auth.HashPassword("pw")
	me, _ := d.CreateUser("me", hash, role)
	srv := &Server{DB: d, Auth: auth.NewService(d)}
	rec := httptest.NewRecorder()
	srv.Routes().ServeHTTP(rec, httptest.NewRequest("POST", "/api/auth/login", strings.NewReader(`{"username":"me","password":"pw"}`)))
	return srv, rec.Result().Cookies()[0], me
}

func TestListUsersRequiresAdmin(t *testing.T) {
	srv, cookie, _ := newUsersAPI(t, "readonly")
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/api/users", nil)
	req.AddCookie(cookie)
	srv.Routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Errorf("code=%d want 403", rec.Code)
	}
}

func TestCreateAndListUserHidesHash(t *testing.T) {
	srv, cookie, _ := newUsersAPI(t, "admin")
	r := srv.Routes()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/users", strings.NewReader(`{"username":"bob","password":"secretpw","role":"readonly"}`))
	req.AddCookie(cookie)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create code=%d body=%s", rec.Code, rec.Body.String())
	}
	listRec := httptest.NewRecorder()
	listReq := httptest.NewRequest("GET", "/api/users", nil)
	listReq.AddCookie(cookie)
	r.ServeHTTP(listRec, listReq)
	if !strings.Contains(listRec.Body.String(), "bob") {
		t.Errorf("list missing bob: %s", listRec.Body.String())
	}
	if strings.Contains(listRec.Body.String(), "secretpw") || strings.Contains(listRec.Body.String(), "password_hash") {
		t.Error("list leaked password material")
	}
}

func TestCannotDeleteSelf(t *testing.T) {
	srv, cookie, me := newUsersAPI(t, "admin")
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("DELETE", "/api/users/"+itoa(me.ID), nil)
	req.AddCookie(cookie)
	srv.Routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("code=%d want 400 (cannot delete self)", rec.Code)
	}
}

func TestCannotDemoteLastAdmin(t *testing.T) {
	srv, cookie, me := newUsersAPI(t, "admin")
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/users/"+itoa(me.ID), strings.NewReader(`{"role":"readonly"}`))
	req.AddCookie(cookie)
	srv.Routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("code=%d want 400 (cannot demote last admin)", rec.Code)
	}
}

func TestChangeOwnPassword(t *testing.T) {
	srv, cookie, _ := newUsersAPI(t, "readonly")
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/auth/password", strings.NewReader(`{"current_password":"pw","new_password":"newpassword"}`))
	req.AddCookie(cookie)
	srv.Routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("code=%d body=%s", rec.Code, rec.Body.String())
	}
	// wrong current password rejected
	rec2 := httptest.NewRecorder()
	req2 := httptest.NewRequest("POST", "/api/auth/password", strings.NewReader(`{"current_password":"WRONG","new_password":"x2"}`))
	req2.AddCookie(cookie)
	srv.Routes().ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusBadRequest {
		t.Errorf("wrong-current code=%d want 400", rec2.Code)
	}
}
```
Also add this tiny helper at the bottom of `users_test.go`:
```go
import "strconv"

func itoa(i int64) string { return strconv.FormatInt(i, 10) }
```
(Place the `import "strconv"` with the other imports, not inline — merge into the import block; the `itoa` func stays.)

- [ ] **Step 4: Run `go test ./internal/api/ -run 'User|ChangeOwnPassword'` — confirm FAIL.**

- [ ] **Step 5: Write `src/internal/api/users.go`**

```go
package api

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/HungHD/garage-admin/internal/auth"
	"github.com/HungHD/garage-admin/internal/db"
)

func (s *Server) mountUsers(r chi.Router) {
	r.Route("/users", func(r chi.Router) {
		r.Use(s.Auth.RequireAuth)
		r.Use(s.Auth.RequireAdmin)
		r.Get("/", s.handleListUsers)
		r.Post("/", s.handleCreateUser)
		r.Post("/{id}", s.handleUpdateUser)
		r.Delete("/{id}", s.handleDeleteUser)
	})
}

func userListView(u *db.User) map[string]any {
	return map[string]any{"id": u.ID, "username": u.Username, "role": u.Role, "created_at": u.CreatedAt}
}

func (s *Server) handleListUsers(w http.ResponseWriter, r *http.Request) {
	users, err := s.DB.ListUsers()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "list failed")
		return
	}
	out := make([]map[string]any, 0, len(users))
	for i := range users {
		out = append(out, userListView(&users[i]))
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleCreateUser(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Role     string `json:"role"`
	}
	if err := decodeJSON(r, &body); err != nil || body.Username == "" || body.Password == "" {
		writeError(w, http.StatusBadRequest, "username and password are required")
		return
	}
	if body.Role != "admin" && body.Role != "readonly" {
		writeError(w, http.StatusBadRequest, "role must be admin or readonly")
		return
	}
	hash, err := auth.HashPassword(body.Password)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "hash failed")
		return
	}
	u, err := s.DB.CreateUser(body.Username, hash, body.Role)
	if err != nil {
		writeError(w, http.StatusBadRequest, "username already exists")
		return
	}
	writeJSON(w, http.StatusCreated, userListView(u))
}

func (s *Server) handleUpdateUser(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad id")
		return
	}
	target, err := s.DB.GetUserByID(id)
	if err != nil {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	var body struct {
		Role     *string `json:"role"`
		Password *string `json:"password"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if body.Role != nil {
		if *body.Role != "admin" && *body.Role != "readonly" {
			writeError(w, http.StatusBadRequest, "role must be admin or readonly")
			return
		}
		// Guard: don't demote the last admin.
		if target.Role == "admin" && *body.Role == "readonly" {
			n, _ := s.DB.CountAdmins()
			if n <= 1 {
				writeError(w, http.StatusBadRequest, "không thể hạ quyền admin cuối cùng")
				return
			}
		}
		if err := s.DB.UpdateUserRole(id, *body.Role); err != nil {
			writeError(w, http.StatusInternalServerError, "update failed")
			return
		}
	}
	if body.Password != nil && *body.Password != "" {
		hash, herr := auth.HashPassword(*body.Password)
		if herr != nil {
			writeError(w, http.StatusInternalServerError, "hash failed")
			return
		}
		if err := s.DB.UpdateUserPassword(id, hash); err != nil {
			writeError(w, http.StatusInternalServerError, "update failed")
			return
		}
	}
	updated, _ := s.DB.GetUserByID(id)
	writeJSON(w, http.StatusOK, userListView(updated))
}

func (s *Server) handleDeleteUser(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad id")
		return
	}
	me := auth.UserFromContext(r.Context())
	if me != nil && me.ID == id {
		writeError(w, http.StatusBadRequest, "không thể xóa chính mình")
		return
	}
	target, err := s.DB.GetUserByID(id)
	if err != nil {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if target.Role == "admin" {
		n, _ := s.DB.CountAdmins()
		if n <= 1 {
			writeError(w, http.StatusBadRequest, "không thể xóa admin cuối cùng")
			return
		}
	}
	if err := s.DB.DeleteUser(id); err != nil {
		writeError(w, http.StatusInternalServerError, "delete failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
```

- [ ] **Step 6: Run `go test ./...` (from src/) — confirm all PASS. `go vet ./...`.**

- [ ] **Step 7: Commit**

```
git add src/internal/api/users.go src/internal/api/users_test.go src/internal/api/auth.go src/internal/api/server.go
git commit -m "feat: add user management API and change-password endpoint"
```

---

## Task 3: Frontend — Users page, Profile, enriched Dashboard, user menu

**Files:** MODIFY `src/web/src/api/client.ts`; create `src/web/src/pages/UsersPage.tsx`, `src/web/src/pages/ProfilePage.tsx`; MODIFY `src/web/src/pages/DashboardPage.tsx`, `src/web/src/components/AppShell.tsx`, `src/web/src/App.tsx`.

- [ ] **Step 1: Append type to `src/web/src/api/client.ts`**

```ts
export interface AdminUser {
  id: number
  username: string
  role: 'admin' | 'readonly'
  created_at: string
}
```

- [ ] **Step 2: Create `src/web/src/pages/UsersPage.tsx`**

```tsx
import { useState } from 'react'
import {
  ActionIcon, Badge, Button, Card, Group, Modal, PasswordInput, Select, Stack, Table, Text, TextInput, Title,
} from '@mantine/core'
import { IconPlus, IconTrash, IconKey } from '@tabler/icons-react'
import { useDisclosure } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type AdminUser } from '../api/client'
import { useAuth } from '../auth/AuthContext'

export function UsersPage() {
  const { user: me } = useAuth()
  const qc = useQueryClient()
  const [createOpen, createCtl] = useDisclosure(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<string>('readonly')
  const [resetFor, setResetFor] = useState<AdminUser | null>(null)
  const [newPw, setNewPw] = useState('')

  const { data: users } = useQuery({
    queryKey: ['users'],
    queryFn: async () => (await api.get<AdminUser[]>('/users')).data,
  })

  const err = (e: any, fallback: string) => notifications.show({ color: 'red', message: e?.response?.data?.error || fallback })
  const refresh = () => qc.invalidateQueries({ queryKey: ['users'] })

  const createMut = useMutation({
    mutationFn: async () => (await api.post('/users', { username, password, role })).data,
    onSuccess: () => { refresh(); createCtl.close(); setUsername(''); setPassword(''); setRole('readonly'); notifications.show({ color: 'green', message: 'Đã tạo user' }) },
    onError: (e) => err(e, 'Tạo user thất bại'),
  })
  const roleMut = useMutation({
    mutationFn: async (v: { id: number; role: string }) => (await api.post(`/users/${v.id}`, { role: v.role })).data,
    onSuccess: refresh,
    onError: (e) => err(e, 'Đổi quyền thất bại'),
  })
  const resetMut = useMutation({
    mutationFn: async () => (await api.post(`/users/${resetFor!.id}`, { password: newPw })).data,
    onSuccess: () => { setResetFor(null); setNewPw(''); notifications.show({ color: 'green', message: 'Đã đặt lại mật khẩu' }) },
    onError: (e) => err(e, 'Đặt lại mật khẩu thất bại'),
  })
  const deleteMut = useMutation({
    mutationFn: async (id: number) => api.delete(`/users/${id}`),
    onSuccess: refresh,
    onError: (e) => err(e, 'Xóa thất bại'),
  })

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={3}>Users</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={createCtl.open}>Tạo user</Button>
      </Group>

      <Card withBorder>
        <Table>
          <Table.Thead>
            <Table.Tr><Table.Th>Tài khoản</Table.Th><Table.Th>Vai trò</Table.Th><Table.Th>Tạo lúc</Table.Th><Table.Th /></Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {users?.map((u) => (
              <Table.Tr key={u.id}>
                <Table.Td>{u.username}{u.id === me?.id && <Badge ml={6} size="xs" variant="light">bạn</Badge>}</Table.Td>
                <Table.Td>
                  <Select size="xs" w={130} data={['admin', 'readonly']} value={u.role}
                    onChange={(v) => v && roleMut.mutate({ id: u.id, role: v })} allowDeselect={false} />
                </Table.Td>
                <Table.Td>{new Date(u.created_at).toLocaleString()}</Table.Td>
                <Table.Td>
                  <Group gap={4} justify="flex-end">
                    <ActionIcon variant="subtle" aria-label="reset password" onClick={() => setResetFor(u)}><IconKey size={16} /></ActionIcon>
                    <ActionIcon color="red" variant="subtle" aria-label="delete" disabled={u.id === me?.id} onClick={() => deleteMut.mutate(u.id)}><IconTrash size={16} /></ActionIcon>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>

      <Modal opened={createOpen} onClose={createCtl.close} title="Tạo user">
        <Stack>
          <TextInput label="Tài khoản" value={username} onChange={(e) => setUsername(e.currentTarget.value)} required />
          <PasswordInput label="Mật khẩu" value={password} onChange={(e) => setPassword(e.currentTarget.value)} required />
          <Select label="Vai trò" data={['admin', 'readonly']} value={role} onChange={(v) => setRole(v ?? 'readonly')} allowDeselect={false} />
          <Button onClick={() => createMut.mutate()} loading={createMut.isPending} disabled={!username || !password}>Tạo</Button>
        </Stack>
      </Modal>

      <Modal opened={resetFor != null} onClose={() => setResetFor(null)} title={`Đặt lại mật khẩu: ${resetFor?.username ?? ''}`}>
        <Stack>
          <PasswordInput label="Mật khẩu mới" value={newPw} onChange={(e) => setNewPw(e.currentTarget.value)} required />
          <Button onClick={() => resetMut.mutate()} loading={resetMut.isPending} disabled={!newPw}>Lưu</Button>
        </Stack>
      </Modal>
    </Stack>
  )
}
```

- [ ] **Step 3: Create `src/web/src/pages/ProfilePage.tsx`**

```tsx
import { useState } from 'react'
import { Button, Card, PasswordInput, Stack, Text, Title } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'

export function ProfilePage() {
  const { user } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await api.post('/auth/password', { current_password: current, new_password: next })
      notifications.show({ color: 'green', message: 'Đã đổi mật khẩu' })
      setCurrent(''); setNext('')
    } catch (err: any) {
      notifications.show({ color: 'red', message: err?.response?.data?.error || 'Đổi mật khẩu thất bại' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Stack>
      <Title order={3}>Hồ sơ</Title>
      <Text c="dimmed">Đăng nhập với tài khoản <b>{user?.username}</b> ({user?.role})</Text>
      <Card withBorder maw={420}>
        <form onSubmit={submit}>
          <Stack>
            <Title order={5}>Đổi mật khẩu</Title>
            <PasswordInput label="Mật khẩu hiện tại" value={current} onChange={(e) => setCurrent(e.currentTarget.value)} required />
            <PasswordInput label="Mật khẩu mới" value={next} onChange={(e) => setNext(e.currentTarget.value)} required />
            <Button type="submit" loading={busy} disabled={!current || !next}>Cập nhật</Button>
          </Stack>
        </form>
      </Card>
    </Stack>
  )
}
```

- [ ] **Step 4: Enrich `src/web/src/pages/DashboardPage.tsx`** — replace the file with:

```tsx
import { Card, Grid, Group, Loader, Text, Title, Badge, Stack, SimpleGrid, Anchor } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, type ClusterHealth, type ClusterStatistics, type BucketListItem, type KeyListItem } from '../api/client'
import { fmtBytes } from './BucketsPage'

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <Card withBorder>
      <Text size="sm" c="dimmed">{label}</Text>
      <Text fw={700} size="xl">{value}</Text>
    </Card>
  )
}

export function DashboardPage() {
  const health = useQuery({ queryKey: ['cluster-health'], queryFn: async () => (await api.get<ClusterHealth>('/cluster/health')).data })
  const stats = useQuery({ queryKey: ['cluster-stats'], queryFn: async () => (await api.get<ClusterStatistics>('/cluster/statistics')).data })
  const buckets = useQuery({ queryKey: ['buckets'], queryFn: async () => (await api.get<BucketListItem[]>('/buckets')).data })
  const keys = useQuery({ queryKey: ['keys'], queryFn: async () => (await api.get<KeyListItem[]>('/keys')).data })

  const loading = health.isLoading || stats.isLoading
  const errored = health.error || stats.error

  return (
    <Stack>
      <Title order={3}>Dashboard</Title>
      {loading && <Loader />}
      {errored && <Text c="red">Chưa kết nối được cluster. Kiểm tra Settings.</Text>}
      {health.data && (
        <Group>
          <Text>Trạng thái cluster:</Text>
          <Badge color={health.data.status === 'healthy' ? 'green' : 'red'}>{health.data.status}</Badge>
        </Group>
      )}
      <SimpleGrid cols={{ base: 2, sm: 3, md: 6 }}>
        {health.data && <Stat label="Node kết nối" value={`${health.data.connectedNodes}/${health.data.knownNodes}`} />}
        {health.data && <Stat label="Partitions OK" value={`${health.data.partitionsAllOk}/${health.data.partitions}`} />}
        {stats.data && <Stat label="Dung lượng trống" value={fmtBytes(stats.data.dataAvail)} />}
        {stats.data && <Stat label="Buckets" value={stats.data.bucketCount} />}
        {stats.data && <Stat label="Objects" value={stats.data.totalObjectCount} />}
        {stats.data && <Stat label="Tổng dung lượng" value={fmtBytes(stats.data.totalObjectBytes)} />}
      </SimpleGrid>

      <Title order={5} mt="md">Truy cập nhanh</Title>
      <SimpleGrid cols={{ base: 2, md: 4 }}>
        <Card withBorder component={Link} to="/buckets">
          <Text fw={600}>Buckets</Text>
          <Text size="sm" c="dimmed">{buckets.data?.length ?? '…'} bucket</Text>
        </Card>
        <Card withBorder component={Link} to="/keys">
          <Text fw={600}>Access Keys</Text>
          <Text size="sm" c="dimmed">{keys.data?.length ?? '…'} key</Text>
        </Card>
        <Card withBorder component={Link} to="/cluster">
          <Text fw={600}>Cluster</Text>
          <Text size="sm" c="dimmed">Layout & nodes</Text>
        </Card>
        <Card withBorder component={Link} to="/files">
          <Text fw={600}>Files</Text>
          <Text size="sm" c="dimmed">Duyệt object</Text>
        </Card>
      </SimpleGrid>
    </Stack>
  )
}
```
(If `Anchor` ends up unused after this, remove it from the import to satisfy `noUnusedLocals`. The component uses `Card component={Link}`; `Anchor` may be unnecessary — drop it if the build flags it.)

- [ ] **Step 5: Header user menu + Users nav link — modify `src/web/src/components/AppShell.tsx`**

Add imports:
```tsx
import { Menu, Button } from '@mantine/core'
import { IconUserCircle, IconUsers } from '@tabler/icons-react'
```
(Merge `Menu`/`Button` into the existing `@mantine/core` import, and the icons into the existing `@tabler/icons-react` import. `Button` may already be imported — avoid duplicates.)

Replace the header user `NavLink` (the one with `onClick={logout}`) with a Menu:
```tsx
            <Menu position="bottom-end" withArrow>
              <Menu.Target>
                <Button variant="subtle" leftSection={<IconUserCircle size={18} />}>{user?.username} ({user?.role})</Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item component={Link} to="/profile">Đổi mật khẩu</Menu.Item>
                <Menu.Item color="red" leftSection={<IconLogout size={16} />} onClick={logout}>Đăng xuất</Menu.Item>
              </Menu.Dropdown>
            </Menu>
```
Add a "Users" nav link in the navbar — but only for admins. The AppShell already has `const { user, logout } = useAuth()`. After the "Settings" NavLink, add:
```tsx
        {user?.role === 'admin' && (
          <NavLink component={Link} to="/users" label="Users" active={loc.pathname.startsWith('/users')} leftSection={<IconUsers size={18} />} />
        )}
```

- [ ] **Step 6: Routes — modify `src/web/src/App.tsx`**

Add imports + routes:
```tsx
import { UsersPage } from './pages/UsersPage'
import { ProfilePage } from './pages/ProfilePage'
```
```tsx
        <Route path="/users" element={<UsersPage />} />
        <Route path="/profile" element={<ProfilePage />} />
```

- [ ] **Step 7: Build + rebuild binary**

```bash
cd /Users/hunghd/Repositories/garage-admin/src/web && npm run build
cd /Users/hunghd/Repositories/garage-admin/src && go build ./... && go test ./...
```
Fix any TS errors minimally (unused imports such as `Anchor`/`Grid` in DashboardPage; missing icon names → substitute present equivalents like `IconUser` for `IconUserCircle`). Confirm dist rebuilt.

- [ ] **Step 8: Commit**

```
cd /Users/hunghd/Repositories/garage-admin
git add src/web/src src/internal/web/dist
git commit -m "feat: add users page, profile password change, enriched dashboard"
```

---

## Task 4: Verify end-to-end (controller)

Start the binary, seed the cluster, Playwright MCP verify:
- Dashboard: status badge + stat cards (nodes, partitions, storage avail, buckets, objects, total size) + quick-link cards.
- Users page (admin): the bootstrap admin row shows with "bạn" badge; delete disabled for self. Create a temp user `tmpuser`/readonly → appears; change its role via the Select; reset its password; delete it (cleanup). Verify the last-admin guard isn't hit (admin "admin" remains).
- Profile: change-password form renders; (optionally) change and revert the temp user's password, or just verify the wrong-current-password path shows the error toast.
- Readonly check (optional): a readonly user does not see the Users nav link.

Clean up any temp users created. No code changes expected.

---

## Self-Review

**Spec coverage (Phase 6 = Dashboard nâng cao + quản lý user from the design spec):**
- User CRUD (admin): list/create/change-role/reset-password/delete → Tasks 1,2,3. ✓
- Guards: no self-delete, no deleting/demoting last admin → Task 2 (+ tests). ✓
- Self-service change password → Task 2 (`/auth/password`), Task 3 (Profile). ✓
- Dashboard enrichment (storage, bucket/key/object counts, quick links) → Task 3. ✓
- Users area admin-only (frontend nav gated + backend `RequireAdmin`) → Tasks 2,3. ✓

**Placeholder scan:** No TBD/TODO; all code complete. The delete-last-admin guard is implemented in `handleDeleteUser`; `TestCannotDemoteLastAdmin` exercises the same `CountAdmins<=1` guard on the update path.

**Type consistency:** `userListView` returns `{id, username, role, created_at}` (never `password_hash`); frontend `AdminUser` matches. Change-password body uses snake_case `current_password`/`new_password` consistently. User-management mutations are admin-only (`RequireAuth`+`RequireAdmin` on the `/users` group); change-password is auth-only. Dashboard reuses existing typed endpoints.

**Security:** password hashes never leave the server (test asserts no `password_hash`/plaintext in list output); change-password verifies the current password; last-admin and self-delete guards prevent lockout.
