package web

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestServesIndexForUnknownPath(t *testing.T) {
	h := Handler()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/some/spa/route", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d, want 200", rec.Code)
	}
	if rec.Header().Get("Content-Type") == "" {
		t.Error("expected a content-type")
	}
}
