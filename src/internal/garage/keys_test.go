package garage

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestListKeys(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v2/ListKeys" {
			t.Errorf("path=%q", r.URL.Path)
		}
		w.Write([]byte(`[{"id":"GK1","name":"k","created":"x","expiration":null,"expired":false}]`))
	}))
	defer srv.Close()
	got, err := New(srv.URL, "t").ListKeys()
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].ID != "GK1" || got[0].Name != "k" {
		t.Errorf("got %+v", got)
	}
}

func TestCreateKeyReturnsSecret(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v2/CreateKey" {
			t.Errorf("path=%q", r.URL.Path)
		}
		var body map[string]string
		b, _ := io.ReadAll(r.Body)
		json.Unmarshal(b, &body)
		if body["name"] != "mykey" {
			t.Errorf("body=%v", body)
		}
		w.Write([]byte(`{"accessKeyId":"GK9","secretAccessKey":"SECRET","created":"x","name":"mykey","expiration":null,"expired":false,"permissions":{"createBucket":false},"buckets":[]}`))
	}))
	defer srv.Close()
	got, err := New(srv.URL, "t").CreateKey("mykey")
	if err != nil {
		t.Fatal(err)
	}
	if got.SecretAccessKey == nil || *got.SecretAccessKey != "SECRET" || got.AccessKeyID != "GK9" {
		t.Errorf("got %+v", got)
	}
}

func TestGetKeyInfoShowSecret(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("id") != "GK1" || r.URL.Query().Get("showSecretKey") != "true" {
			t.Errorf("q=%q", r.URL.RawQuery)
		}
		w.Write([]byte(`{"accessKeyId":"GK1","secretAccessKey":"S","created":"x","name":"k","expiration":null,"expired":false,"permissions":{"createBucket":true},"buckets":[{"id":"b1","globalAliases":["files"],"localAliases":[],"permissions":{"read":true,"write":false,"owner":false}}]}`))
	}))
	defer srv.Close()
	got, err := New(srv.URL, "t").GetKeyInfo("GK1", true)
	if err != nil {
		t.Fatal(err)
	}
	if !got.Permissions.CreateBucket || len(got.Buckets) != 1 || got.Buckets[0].ID != "b1" {
		t.Errorf("got %+v", got)
	}
}

func TestUpdateKeyAllowDeny(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v2/UpdateKey" || r.URL.Query().Get("id") != "GK1" {
			t.Errorf("path=%q q=%q", r.URL.Path, r.URL.RawQuery)
		}
		var req UpdateKeyRequest
		b, _ := io.ReadAll(r.Body)
		json.Unmarshal(b, &req)
		if req.Name == nil || *req.Name != "renamed" || req.Allow == nil || !req.Allow.CreateBucket {
			t.Errorf("req=%+v", req)
		}
		w.Write([]byte(`{"accessKeyId":"GK1","created":"x","name":"renamed","expiration":null,"expired":false,"permissions":{"createBucket":true},"buckets":[]}`))
	}))
	defer srv.Close()
	name := "renamed"
	_, err := New(srv.URL, "t").UpdateKey("GK1", UpdateKeyRequest{Name: &name, Allow: &KeyPermissions{CreateBucket: true}})
	if err != nil {
		t.Fatal(err)
	}
}

func TestDeleteAndImportKey(t *testing.T) {
	var paths []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path+"?"+r.URL.RawQuery)
		w.Write([]byte(`{"accessKeyId":"GKimp","created":"x","name":"imp","expiration":null,"expired":false,"permissions":{"createBucket":false},"buckets":[]}`))
	}))
	defer srv.Close()
	c := New(srv.URL, "t")
	if err := c.DeleteKey("GK1"); err != nil {
		t.Fatal(err)
	}
	if _, err := c.ImportKey("GKimp", "sec", "imp"); err != nil {
		t.Fatal(err)
	}
	if paths[0] != "/v2/DeleteKey?id=GK1" || paths[1] != "/v2/ImportKey?" {
		t.Errorf("paths=%v", paths)
	}
}
