package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestClusterStatisticsProxy(t *testing.T) {
	r, cookie := newGarageBackedAPI(t, "readonly", func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`{"freeform":"x","dataAvail":1,"metadataAvail":1,"incompleteAvailInfo":false,"bucketCount":2,"totalObjectCount":0,"totalObjectBytes":0}`))
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/api/cluster/statistics", nil)
	req.AddCookie(cookie)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "bucketCount") {
		t.Fatalf("code=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestGetLayoutProxy(t *testing.T) {
	r, cookie := newGarageBackedAPI(t, "readonly", func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`{"version":1,"roles":[],"parameters":{"zoneRedundancy":"maximum"},"partitionSize":1,"stagedRoleChanges":[],"stagedParameters":null}`))
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/api/cluster/layout", nil)
	req.AddCookie(cookie)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"version"`) {
		t.Fatalf("code=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestStageLayoutRequiresAdmin(t *testing.T) {
	r, cookie := newGarageBackedAPI(t, "readonly", func(w http.ResponseWriter, _ *http.Request) {})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/cluster/layout/stage", strings.NewReader(`{"changes":[]}`))
	req.AddCookie(cookie)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Errorf("code=%d want 403", rec.Code)
	}
}

func TestApplyLayoutProxiesVersion(t *testing.T) {
	var sawVersion bool
	r, cookie := newGarageBackedAPI(t, "admin", func(w http.ResponseWriter, req *http.Request) {
		if req.URL.Path == "/v2/ApplyClusterLayout" {
			b := make([]byte, 64)
			n, _ := req.Body.Read(b)
			sawVersion = strings.Contains(string(b[:n]), `"version"`)
		}
		w.Write([]byte(`{"message":["applied"]}`))
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/cluster/layout/apply", strings.NewReader(`{"version":3}`))
	req.AddCookie(cookie)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !sawVersion {
		t.Fatalf("code=%d sawVersion=%v", rec.Code, sawVersion)
	}
}

func TestConnectNodesProxy(t *testing.T) {
	var gotPath string
	r, cookie := newGarageBackedAPI(t, "admin", func(w http.ResponseWriter, req *http.Request) {
		gotPath = req.URL.Path
		w.Write([]byte(`[{"success":true,"error":null}]`))
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/cluster/connect", strings.NewReader(`{"nodes":["n1@1.2.3.4:3901"]}`))
	req.AddCookie(cookie)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || gotPath != "/v2/ConnectClusterNodes" {
		t.Fatalf("code=%d path=%q", rec.Code, gotPath)
	}
}
