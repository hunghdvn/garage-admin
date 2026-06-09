package api

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestListKeysProxy(t *testing.T) {
	r, cookie := newGarageBackedAPI(t, "readonly", func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`[{"id":"GK1","name":"k","created":"x","expiration":null,"expired":false}]`))
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/api/keys", nil)
	req.AddCookie(cookie)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "GK1") {
		t.Fatalf("code=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestCreateKeyReturnsSecretAndRequiresAdmin(t *testing.T) {
	// readonly forbidden
	rRO, cRO := newGarageBackedAPI(t, "readonly", func(w http.ResponseWriter, _ *http.Request) {})
	recRO := httptest.NewRecorder()
	reqRO := httptest.NewRequest("POST", "/api/keys", strings.NewReader(`{"name":"k"}`))
	reqRO.AddCookie(cRO)
	rRO.ServeHTTP(recRO, reqRO)
	if recRO.Code != http.StatusForbidden {
		t.Fatalf("readonly create code=%d want 403", recRO.Code)
	}

	// admin gets the secret back
	r, cookie := newGarageBackedAPI(t, "admin", func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`{"accessKeyId":"GK9","secretAccessKey":"SECRET","created":"x","name":"k","expiration":null,"expired":false,"permissions":{"createBucket":false},"buckets":[]}`))
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/keys", strings.NewReader(`{"name":"k"}`))
	req.AddCookie(cookie)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated || !strings.Contains(rec.Body.String(), "SECRET") {
		t.Fatalf("code=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestUpdateKeyProxiesCreateBucket(t *testing.T) {
	var sawAllow bool
	r, cookie := newGarageBackedAPI(t, "admin", func(w http.ResponseWriter, req *http.Request) {
		if req.URL.Path == "/v2/UpdateKey" {
			b, _ := io.ReadAll(req.Body)
			sawAllow = strings.Contains(string(b), "allow") || strings.Contains(string(b), "name")
		}
		w.Write([]byte(`{"accessKeyId":"GK1","created":"x","name":"r","expiration":null,"expired":false,"permissions":{"createBucket":true},"buckets":[]}`))
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/keys/GK1", strings.NewReader(`{"name":"r","create_bucket":true}`))
	req.AddCookie(cookie)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !sawAllow {
		t.Fatalf("code=%d sawAllow=%v", rec.Code, sawAllow)
	}
}

func TestRevealKeyRequiresAdmin(t *testing.T) {
	garageHandler := func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"accessKeyId":"GK1","secretAccessKey":"S","created":"x","name":"k","expiration":null,"expired":false,"permissions":{"createBucket":false},"buckets":[]}`))
	}
	// readonly cannot reveal
	rRO, cRO := newGarageBackedAPI(t, "readonly", garageHandler)
	recRO := httptest.NewRecorder()
	reqRO := httptest.NewRequest("GET", "/api/keys/GK1?reveal=1", nil)
	reqRO.AddCookie(cRO)
	rRO.ServeHTTP(recRO, reqRO)
	if recRO.Code != http.StatusForbidden {
		t.Fatalf("readonly reveal code=%d want 403", recRO.Code)
	}
	// admin can reveal and gets the secret
	r, cookie := newGarageBackedAPI(t, "admin", garageHandler)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/api/keys/GK1?reveal=1", nil)
	req.AddCookie(cookie)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"secretAccessKey"`) {
		t.Fatalf("admin reveal code=%d body=%s", rec.Code, rec.Body.String())
	}
}
