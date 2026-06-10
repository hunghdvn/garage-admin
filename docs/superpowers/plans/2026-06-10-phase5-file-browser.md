# Phase 5 — File Browser (S3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Browse objects inside a bucket (folders + files by prefix), upload files, download files, delete objects, and create folders — using Garage's **S3 API** with the per-cluster S3 credentials stored in Settings.

**Architecture:** New `internal/s3` package wrapping **minio-go** behind a small `Client` interface (so API handlers can be unit-tested with a mock). API handlers under `/api/files/*` build an S3 client from the selected cluster's stored S3 credentials (`s3_endpoint`, `s3_region`, `s3_access_key`, decrypted `s3_secret_key_enc`) via an injectable factory on `Server`. Reads (list/download) require auth; mutations (upload/delete/folder) require admin. Uploads and downloads stream through the backend (low memory on the NAS). Frontend adds a `FilesPage` (bucket selector + path breadcrumb + table) and a "Browse files" link from the bucket detail page. Verified live against Garage v2.3.0 S3 (`:3900`).

**Tech stack:** Adds `github.com/minio/minio-go/v7` (pure-Go S3 client). Everything else as before.

**Branch:** `phase5-file-browser` (off `phase4-node-block-tokens`). Module root `src/`; run `go` from `src/`.

**Prerequisite for use:** the selected cluster must have S3 credentials filled in Settings (S3 access key + secret of a Garage key that has read/write on the buckets). The S3 endpoint defaults to `http://<garage>:3900`.

---

## File Structure

```
src/internal/s3/s3.go              # Client interface + minio impl + entry mapping (+ s3_test.go)
src/internal/api/files.go          # /api/files/* handlers + s3ClientForRequest (+ files_test.go)
src/internal/api/server.go         # MODIFY: add NewS3 factory field + mount files
src/cmd/garage-admin/main.go       # MODIFY: wire NewS3 = s3.New
src/web/src/api/client.ts          # MODIFY: add FileEntry type
src/web/src/pages/FilesPage.tsx     # NEW
src/web/src/pages/BucketDetailPage.tsx  # MODIFY: add "Browse files" link
src/web/src/components/AppShell.tsx # MODIFY: nav link
src/web/src/App.tsx                 # MODIFY: route
```

---

## Task 1: S3 client package

**Files:** Create `src/internal/s3/s3.go`, `src/internal/s3/s3_test.go`

- [ ] **Step 1: Add the dependency**

```bash
cd /Users/hunghd/Repositories/garage-admin/src
go get github.com/minio/minio-go/v7@latest
```

- [ ] **Step 2: Write `src/internal/s3/s3_test.go`** (tests the pure helpers — endpoint parsing and entry naming; the network methods are verified live)

```go
package s3

import "testing"

func TestParseEndpoint(t *testing.T) {
	cases := []struct {
		in     string
		host   string
		secure bool
	}{
		{"http://192.168.101.8:3900", "192.168.101.8:3900", false},
		{"https://s3.example.com", "s3.example.com", true},
		{"192.168.1.5:3900", "192.168.1.5:3900", false},
	}
	for _, c := range cases {
		host, secure, err := parseEndpoint(c.in)
		if err != nil {
			t.Fatalf("%s: %v", c.in, err)
		}
		if host != c.host || secure != c.secure {
			t.Errorf("%s -> host=%q secure=%v; want %q %v", c.in, host, secure, c.host, c.secure)
		}
	}
}

func TestEntryFromKey(t *testing.T) {
	// directory marker under prefix "docs/"
	d := entryFromKey("docs/img/", "docs/", 0, "")
	if !d.IsDir || d.Name != "img" {
		t.Errorf("dir entry = %+v", d)
	}
	// file under prefix "docs/"
	f := entryFromKey("docs/readme.txt", "docs/", 12, "2026-01-01T00:00:00Z")
	if f.IsDir || f.Name != "readme.txt" || f.Size != 12 {
		t.Errorf("file entry = %+v", f)
	}
	// file at root (empty prefix)
	r := entryFromKey("top.bin", "", 5, "")
	if r.IsDir || r.Name != "top.bin" {
		t.Errorf("root entry = %+v", r)
	}
}
```

- [ ] **Step 3: Run `go test ./internal/s3/` — confirm FAIL (build error).**

- [ ] **Step 4: Write `src/internal/s3/s3.go`**

```go
// Package s3 wraps an S3-compatible client (minio-go) for the file browser.
package s3

import (
	"context"
	"errors"
	"io"
	"net/url"
	"strings"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// Entry is one item in a bucket listing — a folder (IsDir) or an object.
type Entry struct {
	Key          string `json:"key"`
	Name         string `json:"name"`
	IsDir        bool   `json:"is_dir"`
	Size         int64  `json:"size"`
	LastModified string `json:"last_modified"`
}

// Object is a downloadable object stream.
type Object struct {
	Body        io.ReadCloser
	ContentType string
	Size        int64
}

// Client is the S3 surface used by the API handlers (mockable in tests).
type Client interface {
	List(ctx context.Context, bucket, prefix string) ([]Entry, error)
	Get(ctx context.Context, bucket, key string) (*Object, error)
	Put(ctx context.Context, bucket, key string, r io.Reader, size int64, contentType string) error
	Delete(ctx context.Context, bucket, key string) error
}

type minioClient struct{ mc *minio.Client }

// New builds an S3 client from an endpoint URL and static credentials.
func New(endpoint, region, accessKey, secretKey string) (Client, error) {
	host, secure, err := parseEndpoint(endpoint)
	if err != nil {
		return nil, err
	}
	mc, err := minio.New(host, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: secure,
		Region: region,
	})
	if err != nil {
		return nil, err
	}
	return &minioClient{mc: mc}, nil
}

// parseEndpoint splits a URL into host[:port] and a secure flag. A bare
// host:port (no scheme) is treated as insecure (http).
func parseEndpoint(endpoint string) (host string, secure bool, err error) {
	if !strings.Contains(endpoint, "://") {
		return endpoint, false, nil
	}
	u, err := url.Parse(endpoint)
	if err != nil {
		return "", false, err
	}
	if u.Host == "" {
		return "", false, errors.New("invalid endpoint")
	}
	return u.Host, u.Scheme == "https", nil
}

// entryFromKey maps an object key (relative to prefix) into an Entry.
func entryFromKey(key, prefix string, size int64, lastModified string) Entry {
	rel := strings.TrimPrefix(key, prefix)
	if strings.HasSuffix(key, "/") {
		return Entry{Key: key, Name: strings.TrimSuffix(rel, "/"), IsDir: true}
	}
	return Entry{Key: key, Name: rel, IsDir: false, Size: size, LastModified: lastModified}
}

// List returns the immediate children (folders + files) under prefix.
func (c *minioClient) List(ctx context.Context, bucket, prefix string) ([]Entry, error) {
	out := []Entry{}
	for obj := range c.mc.ListObjects(ctx, bucket, minio.ListObjectsOptions{Prefix: prefix, Recursive: false}) {
		if obj.Err != nil {
			return nil, obj.Err
		}
		if obj.Key == prefix {
			continue // skip the folder marker object equal to the prefix itself
		}
		lm := ""
		if !obj.LastModified.IsZero() {
			lm = obj.LastModified.UTC().Format("2006-01-02T15:04:05Z")
		}
		out = append(out, entryFromKey(obj.Key, prefix, obj.Size, lm))
	}
	return out, nil
}

// Get opens an object for streaming download.
func (c *minioClient) Get(ctx context.Context, bucket, key string) (*Object, error) {
	obj, err := c.mc.GetObject(ctx, bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, err
	}
	info, err := obj.Stat()
	if err != nil {
		obj.Close()
		return nil, err
	}
	return &Object{Body: obj, ContentType: info.ContentType, Size: info.Size}, nil
}

// Put uploads an object, streaming from r. size may be -1 if unknown.
func (c *minioClient) Put(ctx context.Context, bucket, key string, r io.Reader, size int64, contentType string) error {
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	_, err := c.mc.PutObject(ctx, bucket, key, r, size, minio.PutObjectOptions{ContentType: contentType})
	return err
}

// Delete removes an object.
func (c *minioClient) Delete(ctx context.Context, bucket, key string) error {
	return c.mc.RemoveObject(ctx, bucket, key, minio.RemoveObjectOptions{})
}
```

- [ ] **Step 5: Run `go test ./internal/s3/` — confirm PASS. Run `go build ./...`.**

- [ ] **Step 6: Commit**

```
git add src/internal/s3/ src/go.mod src/go.sum
git commit -m "feat: add S3 client package (minio-go) for the file browser"
```

---

## Task 2: API handlers — files

**Files:** Create `src/internal/api/files.go`, `src/internal/api/files_test.go`; MODIFY `src/internal/api/server.go`, `src/cmd/garage-admin/main.go`.

- [ ] **Step 1: Add the S3 factory to `Server` and wire it.**

In `src/internal/api/server.go`, add an import for the s3 package and a field on `Server`:
```go
	"github.com/HungHD/garage-admin/internal/s3"
```
Add to the `Server` struct (after `Static http.Handler`):
```go
	// NewS3 builds an S3 client from cluster credentials. Injectable for tests.
	NewS3 func(endpoint, region, accessKey, secretKey string) (s3.Client, error)
```
In `Routes()`, inside the `/api` group, after `s.mountNodes(r)` add:
```go
		s.mountFiles(r)
```

In `src/cmd/garage-admin/main.go`, set the factory when constructing the server:
```go
	srv := &api.Server{
		DB:     database,
		Auth:   authSvc,
		Cipher: cipher,
		Static: web.Handler(),
		NewS3:  s3.New,
	}
```
Add the import `"github.com/HungHD/garage-admin/internal/s3"` to main.go.

- [ ] **Step 2: Write `src/internal/api/files_test.go`**

```go
package api

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/HungHD/garage-admin/internal/auth"
	"github.com/HungHD/garage-admin/internal/crypto"
	"github.com/HungHD/garage-admin/internal/db"
	"github.com/HungHD/garage-admin/internal/s3"
)

// fakeS3 implements s3.Client for handler tests.
type fakeS3 struct {
	entries  []s3.Entry
	putKey   string
	putBody  string
	delKey   string
	getBody  string
}

func (f *fakeS3) List(_ context.Context, _, _ string) ([]s3.Entry, error) { return f.entries, nil }
func (f *fakeS3) Get(_ context.Context, _, key string) (*s3.Object, error) {
	return &s3.Object{Body: io.NopCloser(strings.NewReader(f.getBody)), ContentType: "text/plain", Size: int64(len(f.getBody))}, nil
}
func (f *fakeS3) Put(_ context.Context, _, key string, r io.Reader, _ int64, _ string) error {
	b, _ := io.ReadAll(r)
	f.putKey, f.putBody = key, string(b)
	return nil
}
func (f *fakeS3) Delete(_ context.Context, _, key string) error { f.delKey = key; return nil }

func newFilesAPI(t *testing.T, role string, fake *fakeS3) (http.Handler, *http.Cookie) {
	t.Helper()
	d, err := db.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	hash, _ := auth.HashPassword("pw")
	d.CreateUser("u", hash, role)
	cph, _ := crypto.New([]byte("0123456789abcdef0123456789abcdef"))
	tokEnc, _ := cph.Encrypt("tok")
	secEnc, _ := cph.Encrypt("s3secret")
	d.CreateCluster(&db.Cluster{
		Name: "c", AdminEndpoint: "http://x", AdminTokenEnc: tokEnc,
		S3Endpoint: "http://192.168.101.8:3900", S3Region: "garage",
		S3AccessKey: "GK", S3SecretKeyEnc: secEnc, IsDefault: true,
	})
	srv := &Server{
		DB: d, Auth: auth.NewService(d), Cipher: cph,
		NewS3: func(endpoint, region, ak, sk string) (s3.Client, error) { return fake, nil },
	}
	r := srv.Routes()
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest("POST", "/api/auth/login", strings.NewReader(`{"username":"u","password":"pw"}`)))
	return r, rec.Result().Cookies()[0]
}

func TestListFiles(t *testing.T) {
	fake := &fakeS3{entries: []s3.Entry{{Key: "a/", Name: "a", IsDir: true}, {Key: "f.txt", Name: "f.txt", Size: 3}}}
	r, cookie := newFilesAPI(t, "readonly", fake)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/api/files?bucket=b&prefix=", nil)
	req.AddCookie(cookie)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "f.txt") {
		t.Fatalf("code=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestListFilesRequiresBucket(t *testing.T) {
	r, cookie := newFilesAPI(t, "readonly", &fakeS3{})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/api/files", nil)
	req.AddCookie(cookie)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("code=%d want 400", rec.Code)
	}
}

func TestDownloadStreams(t *testing.T) {
	fake := &fakeS3{getBody: "hello"}
	r, cookie := newFilesAPI(t, "readonly", fake)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/api/files/download?bucket=b&key=f.txt", nil)
	req.AddCookie(cookie)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || rec.Body.String() != "hello" {
		t.Fatalf("code=%d body=%q", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Header().Get("Content-Disposition"), "f.txt") {
		t.Errorf("missing content-disposition: %q", rec.Header().Get("Content-Disposition"))
	}
}

func TestUploadRequiresAdmin(t *testing.T) {
	r, cookie := newFilesAPI(t, "readonly", &fakeS3{})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/files/upload?bucket=b&key=x.txt", strings.NewReader("data"))
	req.AddCookie(cookie)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Errorf("code=%d want 403", rec.Code)
	}
}

func TestUploadAndDeleteAsAdmin(t *testing.T) {
	fake := &fakeS3{}
	r, cookie := newFilesAPI(t, "admin", fake)

	up := httptest.NewRecorder()
	upReq := httptest.NewRequest("POST", "/api/files/upload?bucket=b&key=dir/x.txt", strings.NewReader("payload"))
	upReq.Header.Set("Content-Type", "text/plain")
	upReq.AddCookie(cookie)
	r.ServeHTTP(up, upReq)
	if up.Code != http.StatusOK || fake.putKey != "dir/x.txt" || fake.putBody != "payload" {
		t.Fatalf("upload code=%d key=%q body=%q", up.Code, fake.putKey, fake.putBody)
	}

	del := httptest.NewRecorder()
	delReq := httptest.NewRequest("DELETE", "/api/files?bucket=b&key=dir/x.txt", nil)
	delReq.AddCookie(cookie)
	r.ServeHTTP(del, delReq)
	if del.Code != http.StatusOK || fake.delKey != "dir/x.txt" {
		t.Fatalf("delete code=%d key=%q", del.Code, fake.delKey)
	}
}

func TestCreateFolderAsAdmin(t *testing.T) {
	fake := &fakeS3{}
	r, cookie := newFilesAPI(t, "admin", fake)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/files/folder?bucket=b&prefix=newdir", nil)
	req.AddCookie(cookie)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || fake.putKey != "newdir/" {
		t.Fatalf("code=%d putKey=%q (want newdir/)", rec.Code, fake.putKey)
	}
}
```

- [ ] **Step 3: Run `go test ./internal/api/ -run File` — confirm FAIL.**

- [ ] **Step 4: Write `src/internal/api/files.go`**

```go
package api

import (
	"io"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/HungHD/garage-admin/internal/s3"
)

func (s *Server) mountFiles(r chi.Router) {
	r.Route("/files", func(r chi.Router) {
		r.Use(s.Auth.RequireAuth)
		r.Get("/", s.handleListFiles)
		r.Get("/download", s.handleDownloadFile)
		r.With(s.Auth.RequireAdmin).Post("/upload", s.handleUploadFile)
		r.With(s.Auth.RequireAdmin).Post("/folder", s.handleCreateFolder)
		r.With(s.Auth.RequireAdmin).Delete("/", s.handleDeleteFile)
	})
}

// s3ClientForRequest builds an S3 client from the selected cluster's stored
// credentials. Cluster is chosen by ?cluster=, falling back to the default.
func (s *Server) s3ClientForRequest(r *http.Request) (s3.Client, error) {
	c, err := s.clusterForRequest(r)
	if err != nil {
		return nil, err
	}
	if c.S3AccessKey == "" || c.S3SecretKeyEnc == "" {
		return nil, errS3NotConfigured
	}
	secret, err := s.Cipher.Decrypt(c.S3SecretKeyEnc)
	if err != nil {
		return nil, err
	}
	return s.NewS3(c.S3Endpoint, c.S3Region, c.S3AccessKey, secret)
}

func (s *Server) handleListFiles(w http.ResponseWriter, r *http.Request) {
	bucket := r.URL.Query().Get("bucket")
	if bucket == "" {
		writeError(w, http.StatusBadRequest, "bucket is required")
		return
	}
	client, err := s.s3ClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	entries, err := client.List(r.Context(), bucket, r.URL.Query().Get("prefix"))
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, entries)
}

func (s *Server) handleDownloadFile(w http.ResponseWriter, r *http.Request) {
	bucket := r.URL.Query().Get("bucket")
	key := r.URL.Query().Get("key")
	if bucket == "" || key == "" {
		writeError(w, http.StatusBadRequest, "bucket and key are required")
		return
	}
	client, err := s.s3ClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	obj, err := client.Get(r.Context(), bucket, key)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	defer obj.Body.Close()
	name := key
	if i := strings.LastIndex(key, "/"); i >= 0 {
		name = key[i+1:]
	}
	if obj.ContentType != "" {
		w.Header().Set("Content-Type", obj.ContentType)
	}
	w.Header().Set("Content-Disposition", "attachment; filename=\""+name+"\"")
	io.Copy(w, obj.Body)
}

func (s *Server) handleUploadFile(w http.ResponseWriter, r *http.Request) {
	bucket := r.URL.Query().Get("bucket")
	key := r.URL.Query().Get("key")
	if bucket == "" || key == "" {
		writeError(w, http.StatusBadRequest, "bucket and key are required")
		return
	}
	client, err := s.s3ClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	defer r.Body.Close()
	if err := client.Put(r.Context(), bucket, key, r.Body, r.ContentLength, r.Header.Get("Content-Type")); err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleCreateFolder(w http.ResponseWriter, r *http.Request) {
	bucket := r.URL.Query().Get("bucket")
	prefix := r.URL.Query().Get("prefix")
	if bucket == "" || prefix == "" {
		writeError(w, http.StatusBadRequest, "bucket and prefix are required")
		return
	}
	key := strings.TrimSuffix(prefix, "/") + "/"
	client, err := s.s3ClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := client.Put(r.Context(), bucket, key, strings.NewReader(""), 0, ""); err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleDeleteFile(w http.ResponseWriter, r *http.Request) {
	bucket := r.URL.Query().Get("bucket")
	key := r.URL.Query().Get("key")
	if bucket == "" || key == "" {
		writeError(w, http.StatusBadRequest, "bucket and key are required")
		return
	}
	client, err := s.s3ClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := client.Delete(r.Context(), bucket, key); err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
```

- [ ] **Step 5: Add helpers in `cluster_status.go` (refactor) — extract `clusterForRequest` and `errS3NotConfigured`.**

The existing `garageClientForRequest` selects a cluster inline. Extract the cluster-selection logic so `s3ClientForRequest` can reuse it. In `src/internal/api/cluster_status.go`, add:
```go
import "errors" // add to the existing import block

var errS3NotConfigured = errors.New("S3 credentials not configured for this cluster")

// clusterForRequest returns the cluster selected by ?cluster=, or the default.
func (s *Server) clusterForRequest(r *http.Request) (*db.Cluster, error) {
	if idStr := r.URL.Query().Get("cluster"); idStr != "" {
		id, perr := strconv.ParseInt(idStr, 10, 64)
		if perr != nil {
			return nil, perr
		}
		return s.DB.GetCluster(id)
	}
	return s.DB.GetDefaultCluster()
}
```
Then refactor `garageClientForRequest` to use it:
```go
func (s *Server) garageClientForRequest(r *http.Request) (*garage.Client, error) {
	c, err := s.clusterForRequest(r)
	if err != nil {
		return nil, err
	}
	token, err := s.Cipher.Decrypt(c.AdminTokenEnc)
	if err != nil {
		return nil, err
	}
	return garage.New(c.AdminEndpoint, token), nil
}
```
(`db`, `strconv`, `garage` are already imported in cluster_status.go; add `errors`.)

- [ ] **Step 6: Run `go test ./...` (from src/) — confirm all PASS. `go vet ./...`.**

- [ ] **Step 7: Commit**

```
git add src/internal/api/files.go src/internal/api/files_test.go src/internal/api/server.go src/internal/api/cluster_status.go src/cmd/garage-admin/main.go
git commit -m "feat: add file browser (S3) API handlers"
```

---

## Task 3: Frontend — Files page

**Files:** MODIFY `src/web/src/api/client.ts`; create `src/web/src/pages/FilesPage.tsx`; MODIFY `src/web/src/pages/BucketDetailPage.tsx`, `src/web/src/components/AppShell.tsx`, `src/web/src/App.tsx`.

- [ ] **Step 1: Append type to `src/web/src/api/client.ts`**

```ts
export interface FileEntry {
  key: string
  name: string
  is_dir: boolean
  size: number
  last_modified: string
}
```

- [ ] **Step 2: Create `src/web/src/pages/FilesPage.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react'
import {
  ActionIcon, Anchor, Breadcrumbs, Button, Card, Group, Loader, Modal, Select, Stack, Table, Text, TextInput, Title,
} from '@mantine/core'
import { IconFolderPlus, IconUpload, IconTrash, IconDownload, IconFolder, IconFile } from '@tabler/icons-react'
import { useDisclosure } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { api, type BucketListItem, type FileEntry } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { fmtBytes } from './BucketsPage'

export function FilesPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const bucket = params.get('bucket') ?? ''
  const prefix = params.get('prefix') ?? ''
  const fileInput = useRef<HTMLInputElement>(null)
  const [folderOpen, folderCtl] = useDisclosure(false)
  const [folderName, setFolderName] = useState('')
  const [uploading, setUploading] = useState(false)

  const buckets = useQuery({ queryKey: ['buckets'], queryFn: async () => (await api.get<BucketListItem[]>('/buckets')).data })

  // default the bucket to the first one if none selected
  useEffect(() => {
    if (!bucket && buckets.data && buckets.data.length > 0) {
      const alias = buckets.data[0].globalAliases[0] ?? buckets.data[0].id
      setParams({ bucket: alias })
    }
  }, [buckets.data, bucket, setParams])

  const files = useQuery({
    queryKey: ['files', bucket, prefix],
    queryFn: async () => (await api.get<FileEntry[]>('/files', { params: { bucket, prefix } })).data,
    enabled: !!bucket,
  })

  function setPrefix(p: string) { setParams({ bucket, prefix: p }) }
  function setBucket(b: string) { setParams({ bucket: b }) }

  const segments = prefix ? prefix.replace(/\/$/, '').split('/') : []
  function crumbPrefix(i: number) { return segments.slice(0, i + 1).join('/') + '/' }

  const refresh = () => qc.invalidateQueries({ queryKey: ['files', bucket, prefix] })

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      await api.post('/files/upload', file, {
        params: { bucket, key: prefix + file.name },
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
      })
      notifications.show({ color: 'green', message: `Đã tải lên ${file.name}` })
      refresh()
    } catch (err: any) {
      notifications.show({ color: 'red', message: err?.response?.data?.error || 'Tải lên thất bại' })
    } finally {
      setUploading(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  async function createFolder() {
    try {
      await api.post('/files/folder', null, { params: { bucket, prefix: prefix + folderName } })
      folderCtl.close(); setFolderName(''); refresh()
    } catch (err: any) {
      notifications.show({ color: 'red', message: err?.response?.data?.error || 'Tạo thư mục thất bại' })
    }
  }

  async function remove(entry: FileEntry) {
    try {
      await api.delete('/files', { params: { bucket, key: entry.key } })
      refresh()
    } catch (err: any) {
      notifications.show({ color: 'red', message: err?.response?.data?.error || 'Xóa thất bại' })
    }
  }

  function download(entry: FileEntry) {
    const url = `/api/files/download?bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(entry.key)}`
    window.open(url, '_blank')
  }

  const bucketOptions = (buckets.data ?? []).map((b) => {
    const v = b.globalAliases[0] ?? b.id
    return { value: v, label: v }
  })

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={3}>Files</Title>
        <Select w={260} data={bucketOptions} value={bucket || null} onChange={(v) => v && setBucket(v)} placeholder="Chọn bucket" allowDeselect={false} />
      </Group>

      {!bucket ? (
        <Text c="dimmed">Chọn một bucket để duyệt file.</Text>
      ) : (
        <>
          <Group justify="space-between">
            <Breadcrumbs>
              <Anchor onClick={() => setPrefix('')}>{bucket}</Anchor>
              {segments.map((seg, i) => (
                <Anchor key={i} onClick={() => setPrefix(crumbPrefix(i))}>{seg}</Anchor>
              ))}
            </Breadcrumbs>
            {isAdmin && (
              <Group>
                <Button variant="light" leftSection={<IconFolderPlus size={16} />} onClick={folderCtl.open}>Thư mục mới</Button>
                <Button leftSection={<IconUpload size={16} />} loading={uploading} onClick={() => fileInput.current?.click()}>Tải lên</Button>
                <input ref={fileInput} type="file" hidden onChange={onUpload} />
              </Group>
            )}
          </Group>

          <Card withBorder>
            {files.isLoading ? <Loader /> : files.error ? (
              <Text c="red">Không duyệt được. Kiểm tra S3 credentials của cluster trong Settings.</Text>
            ) : (
              <Table highlightOnHover>
                <Table.Thead>
                  <Table.Tr><Table.Th>Tên</Table.Th><Table.Th>Kích thước</Table.Th><Table.Th>Sửa đổi</Table.Th><Table.Th /></Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {(files.data ?? []).length === 0 && (
                    <Table.Tr><Table.Td colSpan={4}><Text c="dimmed" size="sm">Thư mục trống.</Text></Table.Td></Table.Tr>
                  )}
                  {(files.data ?? []).map((entry) => (
                    <Table.Tr key={entry.key}>
                      <Table.Td>
                        {entry.is_dir ? (
                          <Anchor onClick={() => setPrefix(entry.key)}>
                            <Group gap={6}><IconFolder size={16} />{entry.name}</Group>
                          </Anchor>
                        ) : (
                          <Group gap={6}><IconFile size={16} />{entry.name}</Group>
                        )}
                      </Table.Td>
                      <Table.Td>{entry.is_dir ? '—' : fmtBytes(entry.size)}</Table.Td>
                      <Table.Td>{entry.last_modified ? new Date(entry.last_modified).toLocaleString() : '—'}</Table.Td>
                      <Table.Td>
                        <Group gap={4} justify="flex-end">
                          {!entry.is_dir && (
                            <ActionIcon variant="subtle" aria-label="download" onClick={() => download(entry)}><IconDownload size={16} /></ActionIcon>
                          )}
                          {isAdmin && !entry.is_dir && (
                            <ActionIcon color="red" variant="subtle" aria-label="delete" onClick={() => remove(entry)}><IconTrash size={16} /></ActionIcon>
                          )}
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
          </Card>
        </>
      )}

      <Modal opened={folderOpen} onClose={folderCtl.close} title="Tạo thư mục">
        <Stack>
          <TextInput label="Tên thư mục" value={folderName} onChange={(e) => setFolderName(e.currentTarget.value)} />
          <Button onClick={createFolder} disabled={!folderName}>Tạo</Button>
        </Stack>
      </Modal>
    </Stack>
  )
}
```

- [ ] **Step 3: Add a "Browse files" link on the bucket detail page**

In `src/web/src/pages/BucketDetailPage.tsx`, add the import:
```tsx
import { Link } from 'react-router-dom'
```
(If `Link` or `useParams` is already imported from `react-router-dom`, merge into the existing import instead of adding a duplicate line.) Then, in the title `<Title order={3}>` area, add a button next to it. Find the line rendering the bucket title:
```tsx
      <Title order={3}>{bucket.globalAliases.join(', ') || bucket.id.slice(0, 16)}</Title>
```
and wrap it with a group containing a browse button:
```tsx
      <Group justify="space-between">
        <Title order={3}>{bucket.globalAliases.join(', ') || bucket.id.slice(0, 16)}</Title>
        <Button component={Link} to={`/files?bucket=${encodeURIComponent(bucket.globalAliases[0] ?? bucket.id)}`} variant="light">Duyệt file</Button>
      </Group>
```
Ensure `Button` and `Group` are imported (they already are in this file).

- [ ] **Step 4: Add nav link in `src/web/src/components/AppShell.tsx`**

Add `IconFiles` to the `@tabler/icons-react` import and a nav link after "Buckets" and before "Access Keys":
```tsx
        <NavLink component={Link} to="/files" label="Files" active={loc.pathname.startsWith('/files')} leftSection={<IconFiles size={18} />} />
```

- [ ] **Step 5: Add route in `src/web/src/App.tsx`**

Add `import { FilesPage } from './pages/FilesPage'` and a route:
```tsx
        <Route path="/files" element={<FilesPage />} />
```

- [ ] **Step 6: Build + rebuild binary**

```bash
cd /Users/hunghd/Repositories/garage-admin/src/web && npm run build
cd /Users/hunghd/Repositories/garage-admin/src && go build ./... && go test ./...
```
Fix any TS errors minimally (icon names — if `IconFiles`/`IconFolder`/`IconFile` are missing, substitute present ones like `IconFolderFilled`/`IconFileFilled`). Confirm dist rebuilt.

- [ ] **Step 7: Commit**

```
cd /Users/hunghd/Repositories/garage-admin
git add src/web/src src/internal/web/dist
git commit -m "feat: add file browser page (list/upload/download/delete/folder)"
```

---

## Task 4: Verify end-to-end (controller)

To test live, the cluster needs real S3 credentials. The controller will reveal the existing `s3-main` key's secret (admin token, `GetKeyInfo?showSecretKey=true`), seed a cluster with those S3 creds, then via Playwright MCP:
- Files page: select bucket `files`; the listing renders (likely empty).
- Upload a small temp file → it appears in the list. Download it → contents match. Create a folder → it appears. Delete the file → it disappears. (The `files` bucket is the user's; only add/remove a clearly-named temp object like `admin-ui-test.txt` and clean it up.)
- Read-only behavior: verify upload/delete controls are hidden for a readonly user (optional).

If anything fails, fix as a follow-up task.

---

## Self-Review

**Spec coverage (Phase 5 = File browser from the design spec):**
- Browse by prefix/delimiter (folders + files) → Tasks 1,2,3. ✓
- Upload (streamed) → Tasks 1,2,3. ✓
- Download (streamed through backend) → Tasks 1,2,3. ✓
- Delete object → Tasks 1,2,3. ✓
- Create folder (zero-byte `prefix/` object) → Tasks 1,2,3. ✓
- S3 credentials from cluster settings; reads auth, mutations admin → Tasks 2,3. ✓

**Placeholder scan:** No TBD/TODO; all code complete.

**Type consistency:** `s3.Client` interface implemented by minio adapter and by the test fake; `s3.Entry` JSON tags are snake_case (`is_dir`, `last_modified`) and the frontend `FileEntry` matches. `Server.NewS3` factory defaults to `s3.New` in main and is injected in tests. `clusterForRequest` is shared by `garageClientForRequest` and `s3ClientForRequest` (refactor in Task 2 Step 5). `fmtBytes` reused from BucketsPage.

**Memory note (NAS 1GB):** uploads and downloads stream via `io.Copy` / minio `PutObject` with the request body — no full-file buffering in the handler. minio's multipart default part size (16MB) applies when size is unknown; acceptable on 1GB RAM for typical files.

**Safety:** mutations (upload/delete/folder) are admin-only at the backend (`RequireAdmin`) and hidden for readonly in the UI. Download is a streamed GET (auth required). Live verification only touches a clearly-named temp object in the user's bucket and cleans it up.
