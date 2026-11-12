package garage

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGetClusterHealth(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v2/GetClusterHealth" {
			t.Errorf("path = %q", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer secret-token" {
			t.Errorf("missing bearer token, got %q", r.Header.Get("Authorization"))
		}
		w.Header().Set("Content-Type", "application/json")
		// Real field names of Garage v2 GetClusterHealth (verified against v2.5.0).
		w.Write([]byte(`{"status":"healthy","knownNodes":3,"connectedNodes":3,"storageNodes":3,"storageNodesUp":2,"partitions":256,"partitionsQuorum":256,"partitionsAllOk":256}`))
	}))
	defer srv.Close()

	c := New(srv.URL, "secret-token")
	h, err := c.GetClusterHealth()
	if err != nil {
		t.Fatal(err)
	}
	if h.Status != "healthy" || h.ConnectedNodes != 3 {
		t.Errorf("unexpected health: %+v", h)
	}

	// The API handler forwards this struct as JSON to the web UI, so check what it emits.
	out, err := json.Marshal(h)
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	if err := json.Unmarshal(out, &got); err != nil {
		t.Fatal(err)
	}
	if v, ok := got["storageNodesUp"]; !ok || v != float64(2) {
		t.Errorf("storageNodesUp = %v (present=%v), want 2; emitted %s", v, ok, out)
	}
}

func TestErrorStatusReturnsError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(`{"code":"unauthorized","message":"bad token"}`))
	}))
	defer srv.Close()

	c := New(srv.URL, "x")
	if _, err := c.GetClusterHealth(); err == nil {
		t.Error("expected error on 401")
	}
}
