package api

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
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

func itoa(i int64) string { return strconv.FormatInt(i, 10) }
