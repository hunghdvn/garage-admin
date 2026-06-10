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
	entries     []s3.Entry
	putKey      string
	putBody     string
	delKey      string
	delPrefix   string
	getBody     string
	moveSrc     string
	moveDst     string
	movePfxSrc  string
	movePfxDst  string
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
func (f *fakeS3) Move(_ context.Context, _, src, dst string) error {
	f.moveSrc, f.moveDst = src, dst
	return nil
}
func (f *fakeS3) DeletePrefix(_ context.Context, _, prefix string) error {
	f.delPrefix = prefix
	return nil
}
func (f *fakeS3) MovePrefix(_ context.Context, _, src, dst string) error {
	f.movePfxSrc, f.movePfxDst = src, dst
	return nil
}

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

func TestRenameFileMovesObject(t *testing.T) {
	fake := &fakeS3{}
	r, cookie := newFilesAPI(t, "admin", fake)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/files/rename?bucket=b", strings.NewReader(`{"src":"a/old.txt","dst":"a/new.txt"}`))
	req.AddCookie(cookie)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || fake.moveSrc != "a/old.txt" || fake.moveDst != "a/new.txt" {
		t.Fatalf("code=%d src=%q dst=%q", rec.Code, fake.moveSrc, fake.moveDst)
	}
}

func TestRenameFolderMovesPrefix(t *testing.T) {
	fake := &fakeS3{}
	r, cookie := newFilesAPI(t, "admin", fake)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/files/rename?bucket=b", strings.NewReader(`{"src":"docs/","dst":"papers"}`))
	req.AddCookie(cookie)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || fake.movePfxSrc != "docs/" || fake.movePfxDst != "papers/" {
		t.Fatalf("code=%d src=%q dst=%q", rec.Code, fake.movePfxSrc, fake.movePfxDst)
	}
}

func TestDeleteFolderRecursive(t *testing.T) {
	fake := &fakeS3{}
	r, cookie := newFilesAPI(t, "admin", fake)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("DELETE", "/api/files?bucket=b&key=docs/", nil)
	req.AddCookie(cookie)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || fake.delPrefix != "docs/" || fake.delKey != "" {
		t.Fatalf("code=%d delPrefix=%q delKey=%q", rec.Code, fake.delPrefix, fake.delKey)
	}
}
