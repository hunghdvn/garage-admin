package garage

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCleanupIncompleteUploads(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v2/CleanupIncompleteUploads" {
			t.Errorf("path=%q", r.URL.Path)
		}
		var body map[string]any
		b, _ := io.ReadAll(r.Body)
		json.Unmarshal(b, &body)
		if body["bucketId"] != "bid" || body["olderThanSecs"] == nil {
			t.Errorf("body=%v", body)
		}
		w.Write([]byte(`{"uploadsDeleted":3}`))
	}))
	defer srv.Close()
	if _, err := New(srv.URL, "t").CleanupIncompleteUploads("bid", 3600); err != nil {
		t.Fatal(err)
	}
}

func TestInspectObject(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v2/InspectObject" || r.URL.Query().Get("bucketId") != "bid" || r.URL.Query().Get("key") != "a/b.txt" {
			t.Errorf("path=%q q=%q", r.URL.Path, r.URL.RawQuery)
		}
		w.Write([]byte(`{"bucketId":"bid","key":"a/b.txt","versions":[]}`))
	}))
	defer srv.Close()
	raw, err := New(srv.URL, "t").InspectObject("bid", "a/b.txt")
	if err != nil || len(raw) == 0 {
		t.Fatalf("err=%v raw=%s", err, raw)
	}
}

func TestLocalAlias(t *testing.T) {
	var bodies []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		bodies = append(bodies, r.URL.Path+" "+string(b))
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()
	c := New(srv.URL, "t")
	if err := c.AddBucketAliasLocal("bid", "myalias", "GK1"); err != nil {
		t.Fatal(err)
	}
	if err := c.RemoveBucketAliasLocal("bid", "myalias", "GK1"); err != nil {
		t.Fatal(err)
	}
	want0 := `/v2/AddBucketAlias {"accessKeyId":"GK1","bucketId":"bid","localAlias":"myalias"}`
	want1 := `/v2/RemoveBucketAlias {"accessKeyId":"GK1","bucketId":"bid","localAlias":"myalias"}`
	if bodies[0] != want0 {
		t.Errorf("add local body=%s want %s", bodies[0], want0)
	}
	if bodies[1] != want1 {
		t.Errorf("remove local body=%s want %s", bodies[1], want1)
	}
}

func TestUpdateBucketCorsPassthrough(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]json.RawMessage
		b, _ := io.ReadAll(r.Body)
		json.Unmarshal(b, &body)
		if _, ok := body["corsRules"]; !ok {
			t.Errorf("missing corsRules in body=%s", b)
		}
		w.Write([]byte(`{"id":"bid","created":"x","globalAliases":[],"websiteAccess":false,"keys":[],"objects":0,"bytes":0,"unfinishedUploads":0,"unfinishedMultipartUploads":0,"quotas":{"maxSize":null,"maxObjects":null}}`))
	}))
	defer srv.Close()
	rules := json.RawMessage(`[{"allowOrigins":["*"],"allowMethods":["GET"]}]`)
	_, err := New(srv.URL, "t").UpdateBucket("bid", UpdateBucketRequest{CorsRules: &rules})
	if err != nil {
		t.Fatal(err)
	}
}
