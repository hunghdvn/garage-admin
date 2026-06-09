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

func newClusterAPITest(t *testing.T, role string) (*Server, *http.Cookie) {
	t.Helper()
	d, err := db.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	hash, _ := auth.HashPassword("pw")
	d.CreateUser("u", hash, role)
	cph, _ := crypto.New([]byte("0123456789abcdef0123456789abcdef"))
	srv := &Server{DB: d, Auth: auth.NewService(d), Cipher: cph}

	rec := httptest.NewRecorder()
	srv.Routes().ServeHTTP(rec, httptest.NewRequest("POST", "/api/auth/login", strings.NewReader(`{"username":"u","password":"pw"}`)))
	return srv, rec.Result().Cookies()[0]
}

func TestCreateListClusterHidesSecret(t *testing.T) {
	srv, cookie := newClusterAPITest(t, "admin")
	r := srv.Routes()

	body := `{"name":"local","admin_endpoint":"http://192.168.101.8:3903","admin_token":"tok","s3_endpoint":"http://192.168.101.8:3900","s3_region":"garage","s3_access_key":"GK","s3_secret_key":"sek","is_default":true}`
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/clusters", strings.NewReader(body))
	req.AddCookie(cookie)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create code=%d body=%s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "tok") || strings.Contains(rec.Body.String(), "sek") {
		t.Error("response leaked a secret")
	}

	listRec := httptest.NewRecorder()
	listReq := httptest.NewRequest("GET", "/api/clusters", nil)
	listReq.AddCookie(cookie)
	r.ServeHTTP(listRec, listReq)
	if !strings.Contains(listRec.Body.String(), "local") {
		t.Errorf("list missing cluster: %s", listRec.Body.String())
	}
	if strings.Contains(listRec.Body.String(), "tok") {
		t.Error("list leaked token")
	}
}

func TestReadonlyCannotCreateCluster(t *testing.T) {
	srv, cookie := newClusterAPITest(t, "readonly")
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/clusters", strings.NewReader(`{"name":"x","admin_endpoint":"http://y","admin_token":"t"}`))
	req.AddCookie(cookie)
	srv.Routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Errorf("code = %d, want 403", rec.Code)
	}
}

func TestCreateClusterRejectsBlankName(t *testing.T) {
	srv, cookie := newClusterAPITest(t, "admin")
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/clusters", strings.NewReader(`{"name":"  ","admin_endpoint":"http://x","admin_token":"t"}`))
	req.AddCookie(cookie)
	srv.Routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("code = %d, want 400", rec.Code)
	}
}
