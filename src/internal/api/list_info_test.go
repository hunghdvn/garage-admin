package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// What Garage < v2.5 answers for an endpoint it does not know.
func unknownEndpoint(w http.ResponseWriter) {
	w.WriteHeader(http.StatusBadRequest)
	w.Write([]byte(`{"code":"InvalidRequest","message":"Unknown API endpoint","region":"garage","path":"/v2/x"}`))
}

func getJSON(t *testing.T, r http.Handler, cookie *http.Cookie, path string) []map[string]any {
	t.Helper()
	rec := httptest.NewRecorder()
	req := jsonReq("GET", path, nil)
	req.AddCookie(cookie)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET %s: code=%d body=%s", path, rec.Code, rec.Body.String())
	}
	var out []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("GET %s: %v body=%s", path, err, rec.Body.String())
	}
	return out
}

func TestListBucketsReturnsDetailsFromListBucketsInfo(t *testing.T) {
	r, cookie := newGarageBackedAPI(t, "readonly", func(w http.ResponseWriter, req *http.Request) {
		if req.URL.Path != "/v2/ListBucketsInfo" {
			t.Errorf("unexpected call %s", req.URL.Path)
		}
		w.Write([]byte(`[{"id":"b1","created":"x","globalAliases":["files"],"websiteAccess":false,
			"keys":[{"accessKeyId":"GK1","name":"main","permissions":{"read":true,"write":true,"owner":true},"bucketLocalAliases":[]}],
			"objects":7,"bytes":1234,"unfinishedUploads":0,"unfinishedMultipartUploads":0,"quotas":{"maxSize":null,"maxObjects":null}}]`))
	})
	got := getJSON(t, r, cookie, "/api/buckets")
	if len(got) != 1 || got[0]["id"] != "b1" || got[0]["bytes"] != float64(1234) || got[0]["objects"] != float64(7) {
		t.Fatalf("got %v", got)
	}
	if keys, _ := got[0]["keys"].([]any); len(keys) != 1 {
		t.Errorf("keys = %v", got[0]["keys"])
	}
}

func TestListBucketsFallsBackOnGarageWithoutListBucketsInfo(t *testing.T) {
	r, cookie := newGarageBackedAPI(t, "readonly", func(w http.ResponseWriter, req *http.Request) {
		switch req.URL.Path {
		case "/v2/ListBucketsInfo":
			unknownEndpoint(w)
		case "/v2/ListBuckets":
			w.Write([]byte(`[{"id":"b1","created":"x","globalAliases":["files"],"localAliases":[]}]`))
		default:
			t.Errorf("unexpected call %s", req.URL.Path)
		}
	})
	got := getJSON(t, r, cookie, "/api/buckets")
	if len(got) != 1 || got[0]["id"] != "b1" {
		t.Fatalf("got %v", got)
	}
	if _, ok := got[0]["bytes"]; ok {
		t.Errorf("fallback must not invent sizes: %v", got[0])
	}
}

func TestListKeysReturnsDetailsFromListKeysInfo(t *testing.T) {
	r, cookie := newGarageBackedAPI(t, "readonly", func(w http.ResponseWriter, req *http.Request) {
		if req.URL.Path != "/v2/ListKeysInfo" {
			t.Errorf("unexpected call %s", req.URL.Path)
		}
		// Garage does not send secrets here, but a list readable by readonly users
		// must never forward one even if it did.
		w.Write([]byte(`[{"accessKeyId":"GK1","secretAccessKey":"TOPSECRET","created":"x","name":"main","expiration":null,"expired":false,
			"permissions":{"createBucket":true},
			"buckets":[{"id":"b1","globalAliases":["files"],"localAliases":[],"permissions":{"read":true,"write":false,"owner":false}}]}]`))
	})
	got := getJSON(t, r, cookie, "/api/keys")
	if len(got) != 1 || got[0]["id"] != "GK1" || got[0]["name"] != "main" || got[0]["expired"] != false {
		t.Fatalf("got %v", got)
	}
	if perms, _ := got[0]["permissions"].(map[string]any); perms["createBucket"] != true {
		t.Errorf("permissions = %v", got[0]["permissions"])
	}
	if buckets, _ := got[0]["buckets"].([]any); len(buckets) != 1 {
		t.Errorf("buckets = %v", got[0]["buckets"])
	}
	if b, _ := json.Marshal(got); strings.Contains(string(b), "TOPSECRET") {
		t.Errorf("secret leaked: %s", b)
	}
}

func TestListKeysFallsBackOnGarageWithoutListKeysInfo(t *testing.T) {
	r, cookie := newGarageBackedAPI(t, "readonly", func(w http.ResponseWriter, req *http.Request) {
		switch req.URL.Path {
		case "/v2/ListKeysInfo":
			unknownEndpoint(w)
		case "/v2/ListKeys":
			w.Write([]byte(`[{"id":"GK1","name":"k","created":"x","expiration":null,"expired":false}]`))
		default:
			t.Errorf("unexpected call %s", req.URL.Path)
		}
	})
	got := getJSON(t, r, cookie, "/api/keys")
	if len(got) != 1 || got[0]["id"] != "GK1" || got[0]["name"] != "k" {
		t.Fatalf("got %v", got)
	}
	if _, ok := got[0]["permissions"]; ok {
		t.Errorf("fallback must not invent permissions: %v", got[0])
	}
}

func TestListKeysDoesNotHideRealGarageErrors(t *testing.T) {
	r, cookie := newGarageBackedAPI(t, "readonly", func(w http.ResponseWriter, req *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte(`{"code":"AccessDenied","message":"token lacks scope"}`))
	})
	rec := httptest.NewRecorder()
	req := jsonReq("GET", "/api/keys", nil)
	req.AddCookie(cookie)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("code=%d want 403 body=%s", rec.Code, rec.Body.String())
	}
}
