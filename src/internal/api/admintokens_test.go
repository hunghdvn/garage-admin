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

func TestDeleteAdminTokenRequiresAdmin(t *testing.T) {
	r, cookie := newGarageBackedAPI(t, "readonly", func(w http.ResponseWriter, _ *http.Request) {})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("DELETE", "/api/admin-tokens/tok1", nil)
	req.AddCookie(cookie)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Errorf("code=%d want 403", rec.Code)
	}
}
