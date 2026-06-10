package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCleanupUploadsRequiresAdmin(t *testing.T) {
	r, cookie := newGarageBackedAPI(t, "readonly", func(w http.ResponseWriter, _ *http.Request) {})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/buckets/bid/cleanup-uploads", strings.NewReader(`{"older_than_secs":3600}`))
	req.AddCookie(cookie)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Errorf("code=%d want 403", rec.Code)
	}
}

func TestInspectObjectProxy(t *testing.T) {
	r, cookie := newGarageBackedAPI(t, "readonly", func(w http.ResponseWriter, req *http.Request) {
		if req.URL.Path != "/v2/InspectObject" || req.URL.Query().Get("bucketId") != "bid" || req.URL.Query().Get("key") != "f.txt" {
			t.Errorf("path=%q q=%q", req.URL.Path, req.URL.RawQuery)
		}
		w.Write([]byte(`{"key":"f.txt","versions":[]}`))
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/api/buckets/bid/inspect?key=f.txt", nil)
	req.AddCookie(cookie)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "versions") {
		t.Fatalf("code=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestLocalAliasProxy(t *testing.T) {
	var gotBody string
	r, cookie := newGarageBackedAPI(t, "admin", func(w http.ResponseWriter, req *http.Request) {
		if req.URL.Path == "/v2/AddBucketAlias" {
			b := make([]byte, req.ContentLength)
			req.Body.Read(b)
			gotBody = string(b)
		}
		w.WriteHeader(http.StatusOK)
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/buckets/bid/aliases", strings.NewReader(`{"alias":"al","local":true,"access_key_id":"GK1"}`))
	req.AddCookie(cookie)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(gotBody, "localAlias") || !strings.Contains(gotBody, "GK1") {
		t.Fatalf("code=%d body=%s", rec.Code, gotBody)
	}
}

func TestCreateKeyWithExpirationProxy(t *testing.T) {
	var gotBody string
	r, cookie := newGarageBackedAPI(t, "admin", func(w http.ResponseWriter, req *http.Request) {
		if req.URL.Path == "/v2/CreateKey" {
			b := make([]byte, req.ContentLength)
			req.Body.Read(b)
			gotBody = string(b)
		}
		w.Write([]byte(`{"accessKeyId":"GK9","secretAccessKey":"S","created":"x","name":"k","expiration":null,"expired":false,"permissions":{"createBucket":false},"buckets":[]}`))
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/keys", strings.NewReader(`{"name":"k","expiration":"2030-01-01T00:00:00Z"}`))
	req.AddCookie(cookie)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated || !strings.Contains(gotBody, "expiration") {
		t.Fatalf("code=%d body=%s", rec.Code, gotBody)
	}
}
