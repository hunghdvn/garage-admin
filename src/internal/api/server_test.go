package api

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHealthEndpoint(t *testing.T) {
	srv := &Server{}
	r := srv.Routes()
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, jsonReq("GET", "/api/health", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d, want 200", rec.Code)
	}
	var body map[string]string
	json.Unmarshal(rec.Body.Bytes(), &body)
	if body["status"] != "ok" {
		t.Errorf("status = %q, want ok", body["status"])
	}
}

// jsonReq is httptest.NewRequest that labels non-empty bodies as JSON, as the
// SPA does. Tests needing another type override the header afterwards.
func jsonReq(method, target string, body io.Reader) *http.Request {
	req := httptest.NewRequest(method, target, body)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	return req
}
