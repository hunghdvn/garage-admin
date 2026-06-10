package garage

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNodeReadEndpoints(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("node") != "self" {
			t.Errorf("node=%q", r.URL.Query().Get("node"))
		}
		w.Write([]byte(`{"success":{"n1":{"ok":true}},"error":{}}`))
	}))
	defer srv.Close()
	c := New(srv.URL, "t")
	for _, call := range []func() (json.RawMessage, error){
		func() (json.RawMessage, error) { return c.GetNodeInfo("self") },
		func() (json.RawMessage, error) { return c.GetNodeStatistics("self") },
		func() (json.RawMessage, error) { return c.ListBlockErrors("self") },
	} {
		raw, err := call()
		if err != nil {
			t.Fatal(err)
		}
		if len(raw) == 0 {
			t.Error("empty raw response")
		}
	}
}

func TestListWorkersSendsFlags(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v2/ListWorkers" || r.Method != http.MethodPost {
			t.Errorf("path=%q method=%q", r.URL.Path, r.Method)
		}
		var body map[string]bool
		b, _ := io.ReadAll(r.Body)
		json.Unmarshal(b, &body)
		if !body["busyOnly"] || body["errorOnly"] {
			t.Errorf("flags=%v", body)
		}
		w.Write([]byte(`{"success":{"n1":[]},"error":{}}`))
	}))
	defer srv.Close()
	if _, err := New(srv.URL, "t").ListWorkers("self", true, false); err != nil {
		t.Fatal(err)
	}
}

func TestSetWorkerVariableBody(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]string
		b, _ := io.ReadAll(r.Body)
		json.Unmarshal(b, &body)
		if body["variable"] != "resync-tranquility" || body["value"] != "2" {
			t.Errorf("body=%v", body)
		}
		w.Write([]byte(`{"success":{"n1":null},"error":{}}`))
	}))
	defer srv.Close()
	if _, err := New(srv.URL, "t").SetWorkerVariable("self", "resync-tranquility", "2"); err != nil {
		t.Fatal(err)
	}
}

func TestRepairBody(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]string
		b, _ := io.ReadAll(r.Body)
		json.Unmarshal(b, &body)
		if body["repairType"] != "blocks" {
			t.Errorf("body=%v", body)
		}
		w.Write([]byte(`{"success":{"n1":null},"error":{}}`))
	}))
	defer srv.Close()
	if _, err := New(srv.URL, "t").LaunchRepairOperation("self", "blocks"); err != nil {
		t.Fatal(err)
	}
}

func TestRetryBlockResyncAllVsHashes(t *testing.T) {
	var bodies []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		bodies = append(bodies, string(b))
		w.Write([]byte(`{"success":{"n1":null},"error":{}}`))
	}))
	defer srv.Close()
	c := New(srv.URL, "t")
	if _, err := c.RetryBlockResync("self", true, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := c.RetryBlockResync("self", false, []string{"ab", "cd"}); err != nil {
		t.Fatal(err)
	}
	if bodies[0] != `{"all":true}` {
		t.Errorf("all body=%s", bodies[0])
	}
	if bodies[1] != `{"blockHashes":["ab","cd"]}` {
		t.Errorf("hashes body=%s", bodies[1])
	}
}

func TestPurgeBlocksSendsBareArray(t *testing.T) {
	var body string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		body = string(b)
		w.Write([]byte(`{"success":{"n1":null},"error":{}}`))
	}))
	defer srv.Close()
	if _, err := New(srv.URL, "t").PurgeBlocks("self", []string{"ab", "cd"}); err != nil {
		t.Fatal(err)
	}
	if body != `["ab","cd"]` {
		t.Errorf("purge body=%s", body)
	}
}

func TestGetBlockInfoBody(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]string
		b, _ := io.ReadAll(r.Body)
		json.Unmarshal(b, &body)
		if body["blockHash"] != "deadbeef" {
			t.Errorf("body=%v", body)
		}
		w.Write([]byte(`{"success":{"n1":{}},"error":{}}`))
	}))
	defer srv.Close()
	if _, err := New(srv.URL, "t").GetBlockInfo("self", "deadbeef"); err != nil {
		t.Fatal(err)
	}
}
