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

func TestClusterHealthProxy(t *testing.T) {
	garageSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"status":"healthy","connectedNodes":2}`))
	}))
	defer garageSrv.Close()

	d, _ := db.Open(filepath.Join(t.TempDir(), "t.db"))
	t.Cleanup(func() { d.Close() })
	hash, _ := auth.HashPassword("pw")
	d.CreateUser("u", hash, "admin")
	cph, _ := crypto.New([]byte("0123456789abcdef0123456789abcdef"))
	enc, _ := cph.Encrypt("tok")
	d.CreateCluster(&db.Cluster{Name: "c", AdminEndpoint: garageSrv.URL, AdminTokenEnc: enc, IsDefault: true})

	srv := &Server{DB: d, Auth: auth.NewService(d), Cipher: cph}
	r := srv.Routes()

	loginRec := httptest.NewRecorder()
	r.ServeHTTP(loginRec, httptest.NewRequest("POST", "/api/auth/login", strings.NewReader(`{"username":"u","password":"pw"}`)))
	cookie := loginRec.Result().Cookies()[0]

	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/api/cluster/health", nil)
	req.AddCookie(cookie)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("code=%d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "healthy") {
		t.Errorf("body = %s", rec.Body.String())
	}
}
