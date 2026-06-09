package garage

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestListBuckets(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v2/ListBuckets" {
			t.Errorf("path=%q", r.URL.Path)
		}
		w.Write([]byte(`[{"id":"abc","created":"2026-06-09T16:29:13.800Z","globalAliases":["files"],"localAliases":[]}]`))
	}))
	defer srv.Close()
	got, err := New(srv.URL, "t").ListBuckets()
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].ID != "abc" || got[0].GlobalAliases[0] != "files" {
		t.Errorf("unexpected: %+v", got)
	}
}

func TestGetBucketInfo(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v2/GetBucketInfo" || r.URL.Query().Get("id") != "abc" {
			t.Errorf("path=%q q=%q", r.URL.Path, r.URL.RawQuery)
		}
		w.Write([]byte(`{"id":"abc","created":"x","globalAliases":["files"],"websiteAccess":false,"keys":[{"accessKeyId":"GK1","name":"k","permissions":{"read":true,"write":true,"owner":false},"bucketLocalAliases":[]}],"objects":3,"bytes":99,"unfinishedUploads":0,"unfinishedMultipartUploads":0,"quotas":{"maxSize":null,"maxObjects":null}}`))
	}))
	defer srv.Close()
	got, err := New(srv.URL, "t").GetBucketInfo("abc")
	if err != nil {
		t.Fatal(err)
	}
	if got.Objects != 3 || got.Bytes != 99 || len(got.Keys) != 1 || !got.Keys[0].Permissions.Read {
		t.Errorf("unexpected: %+v", got)
	}
}

func TestCreateBucketSendsGlobalAlias(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v2/CreateBucket" || r.Method != http.MethodPost {
			t.Errorf("path=%q method=%q", r.URL.Path, r.Method)
		}
		var body map[string]any
		b, _ := io.ReadAll(r.Body)
		json.Unmarshal(b, &body)
		if body["globalAlias"] != "newb" {
			t.Errorf("body=%v", body)
		}
		w.Write([]byte(`{"id":"newid","created":"x","globalAliases":["newb"],"websiteAccess":false,"keys":[],"objects":0,"bytes":0,"unfinishedUploads":0,"unfinishedMultipartUploads":0,"quotas":{"maxSize":null,"maxObjects":null}}`))
	}))
	defer srv.Close()
	got, err := New(srv.URL, "t").CreateBucket("newb")
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != "newid" {
		t.Errorf("got %+v", got)
	}
}

func TestUpdateBucketUsesIDQueryAndBody(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v2/UpdateBucket" || r.URL.Query().Get("id") != "abc" {
			t.Errorf("path=%q q=%q", r.URL.Path, r.URL.RawQuery)
		}
		var req UpdateBucketRequest
		b, _ := io.ReadAll(r.Body)
		json.Unmarshal(b, &req)
		if req.Quotas == nil || req.Quotas.MaxObjects == nil || *req.Quotas.MaxObjects != 5 {
			t.Errorf("quotas=%+v", req.Quotas)
		}
		w.Write([]byte(`{"id":"abc","created":"x","globalAliases":[],"websiteAccess":false,"keys":[],"objects":0,"bytes":0,"unfinishedUploads":0,"unfinishedMultipartUploads":0,"quotas":{"maxSize":null,"maxObjects":5}}`))
	}))
	defer srv.Close()
	five := int64(5)
	_, err := New(srv.URL, "t").UpdateBucket("abc", UpdateBucketRequest{Quotas: &Quotas{MaxObjects: &five}})
	if err != nil {
		t.Fatal(err)
	}
}

func TestDeleteBucketUsesIDQuery(t *testing.T) {
	called := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		if r.URL.Path != "/v2/DeleteBucket" || r.URL.Query().Get("id") != "abc" || r.Method != http.MethodPost {
			t.Errorf("path=%q q=%q method=%q", r.URL.Path, r.URL.RawQuery, r.Method)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()
	if err := New(srv.URL, "t").DeleteBucket("abc"); err != nil {
		t.Fatal(err)
	}
	if !called {
		t.Error("not called")
	}
}

func TestAliasAndPermissionEndpoints(t *testing.T) {
	var paths []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()
	c := New(srv.URL, "t")
	if err := c.AddBucketAlias("b", "alias1"); err != nil {
		t.Fatal(err)
	}
	if err := c.RemoveBucketAlias("b", "alias1"); err != nil {
		t.Fatal(err)
	}
	if err := c.AllowBucketKey("b", "GK1", Permissions{Read: true}); err != nil {
		t.Fatal(err)
	}
	if err := c.DenyBucketKey("b", "GK1", Permissions{Owner: true}); err != nil {
		t.Fatal(err)
	}
	want := []string{"/v2/AddBucketAlias", "/v2/RemoveBucketAlias", "/v2/AllowBucketKey", "/v2/DenyBucketKey"}
	for i, p := range want {
		if paths[i] != p {
			t.Errorf("paths[%d]=%q want %q", i, paths[i], p)
		}
	}
}
