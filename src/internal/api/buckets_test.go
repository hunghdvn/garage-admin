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
