package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestNodeInfoProxy(t *testing.T) {
	r, cookie := newGarageBackedAPI(t, "readonly", func(w http.ResponseWriter, req *http.Request) {
		if req.URL.Path != "/v2/GetNodeInfo" || req.URL.Query().Get("node") != "self" {
			t.Errorf("path=%q node=%q", req.URL.Path, req.URL.Query().Get("node"))
		}
		w.Write([]byte(`{"success":{"n1":{"hostname":"h"}},"error":{}}`))
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/api/nodes/info?node=self", nil)
	req.AddCookie(cookie)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "hostname") {
		t.Fatalf("code=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestListWorkersDefaultsNodeSelf(t *testing.T) {
	r, cookie := newGarageBackedAPI(t, "readonly", func(w http.ResponseWriter, req *http.Request) {
		if req.URL.Query().Get("node") != "self" {
			t.Errorf("node=%q want self", req.URL.Query().Get("node"))
		}
		w.Write([]byte(`{"success":{"n1":[]},"error":{}}`))
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/api/nodes/workers", nil) // no node param → default self
	req.AddCookie(cookie)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("code=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestRepairRequiresAdmin(t *testing.T) {
	r, cookie := newGarageBackedAPI(t, "readonly", func(w http.ResponseWriter, _ *http.Request) {})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/nodes/repair?node=self", strings.NewReader(`{"repair_type":"blocks"}`))
	req.AddCookie(cookie)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Errorf("code=%d want 403", rec.Code)
	}
}

func TestPurgeRequiresAdminAndProxies(t *testing.T) {
	var gotPath, gotBody string
	r, cookie := newGarageBackedAPI(t, "admin", func(w http.ResponseWriter, req *http.Request) {
		gotPath = req.URL.Path
		b := make([]byte, req.ContentLength)
		req.Body.Read(b)
		gotBody = string(b)
		w.Write([]byte(`{"success":{},"error":{}}`))
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/nodes/blocks/purge?node=self", strings.NewReader(`{"block_hashes":["ab","cd"]}`))
	req.AddCookie(cookie)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || gotPath != "/v2/PurgeBlocks" {
		t.Fatalf("code=%d path=%q", rec.Code, gotPath)
	}
	if gotBody != `["ab","cd"]` {
		t.Errorf("purge forwarded body=%s want bare array", gotBody)
	}
}
