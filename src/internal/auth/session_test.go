package auth

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/HungHD/garage-admin/internal/db"
)

func newDB(t *testing.T) *db.DB {
	t.Helper()
	d, err := db.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	return d
}

func TestLoginCreatesSessionAndCookie(t *testing.T) {
	d := newDB(t)
	hash, _ := HashPassword("pw")
	user, _ := d.CreateUser("alice", hash, "admin")

	svc := NewService(d)
	rec := httptest.NewRecorder()
	got, err := svc.Login(rec, "alice", "pw")
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != user.ID {
		t.Fatalf("got user %d, want %d", got.ID, user.ID)
	}
	if len(rec.Result().Cookies()) == 0 {
		t.Fatal("expected a session cookie to be set")
	}
}

func TestLoginWrongPassword(t *testing.T) {
	d := newDB(t)
	hash, _ := HashPassword("pw")
	d.CreateUser("alice", hash, "admin")
	svc := NewService(d)
	if _, err := svc.Login(httptest.NewRecorder(), "alice", "bad"); err == nil {
		t.Error("expected error on wrong password")
	}
}

func TestMiddlewareRejectsUnauthenticated(t *testing.T) {
	d := newDB(t)
	svc := NewService(d)
	handler := svc.RequireAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest("GET", "/", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("code = %d, want 401", rec.Code)
	}
}

func TestMiddlewareAllowsAuthenticated(t *testing.T) {
	d := newDB(t)
	hash, _ := HashPassword("pw")
	d.CreateUser("alice", hash, "admin")
	svc := NewService(d)

	loginRec := httptest.NewRecorder()
	svc.Login(loginRec, "alice", "pw")
	cookie := loginRec.Result().Cookies()[0]

	handler := svc.RequireAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u := UserFromContext(r.Context())
		if u == nil || u.Username != "alice" {
			t.Error("expected user in context")
		}
		w.WriteHeader(http.StatusOK)
	}))
	req := httptest.NewRequest("GET", "/", nil)
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("code = %d, want 200", rec.Code)
	}
}

func TestRequireAdminRejectsReadonly(t *testing.T) {
	d := newDB(t)
	hash, _ := HashPassword("pw")
	d.CreateUser("bob", hash, "readonly")
	svc := NewService(d)
	loginRec := httptest.NewRecorder()
	svc.Login(loginRec, "bob", "pw")
	cookie := loginRec.Result().Cookies()[0]

	handler := svc.RequireAuth(svc.RequireAdmin(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})))
	req := httptest.NewRequest("POST", "/", nil)
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Errorf("code = %d, want 403", rec.Code)
	}
}
