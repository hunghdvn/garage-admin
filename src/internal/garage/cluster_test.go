package garage

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGetClusterStatistics(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v2/GetClusterStatistics" {
			t.Errorf("path=%q", r.URL.Path)
		}
		w.Write([]byte(`{"freeform":"hi","dataAvail":100,"metadataAvail":50,"incompleteAvailInfo":false,"bucketCount":1,"totalObjectCount":2,"totalObjectBytes":3}`))
	}))
	defer srv.Close()
	got, err := New(srv.URL, "t").GetClusterStatistics()
	if err != nil {
		t.Fatal(err)
	}
	if got.BucketCount != 1 || got.DataAvail != 100 || got.Freeform != "hi" {
		t.Errorf("got %+v", got)
	}
}

func TestGetClusterLayout(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"version":1,"roles":[{"id":"n1","zone":"dc1","tags":[],"capacity":700,"storedPartitions":256,"usableCapacity":700}],"parameters":{"zoneRedundancy":"maximum"},"partitionSize":27,"stagedRoleChanges":[],"stagedParameters":null}`))
	}))
	defer srv.Close()
	got, err := New(srv.URL, "t").GetClusterLayout()
	if err != nil {
		t.Fatal(err)
	}
	if got.Version != 1 || len(got.Roles) != 1 || got.Roles[0].Zone != "dc1" {
		t.Errorf("got %+v", got)
	}
}

func TestGetClusterLayoutHistory(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"currentVersion":1,"minAck":1,"versions":[{"version":1,"status":"Current","storageNodes":1,"gatewayNodes":0}],"updateTrackers":null}`))
	}))
	defer srv.Close()
	got, err := New(srv.URL, "t").GetClusterLayoutHistory()
	if err != nil {
		t.Fatal(err)
	}
	if got.CurrentVersion != 1 || len(got.Versions) != 1 || got.Versions[0].Status != "Current" {
		t.Errorf("got %+v", got)
	}
}

func TestUpdateClusterLayoutSendsArray(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v2/UpdateClusterLayout" || r.Method != http.MethodPost {
			t.Errorf("path=%q method=%q", r.URL.Path, r.Method)
		}
		var arr []NodeRoleChange
		b, _ := io.ReadAll(r.Body)
		if err := json.Unmarshal(b, &arr); err != nil {
			t.Fatalf("body not an array: %s", b)
		}
		if len(arr) != 1 || arr[0].NodeID != "n1" || arr[0].Capacity == nil || *arr[0].Capacity != 500 {
			t.Errorf("arr=%+v", arr)
		}
		w.Write([]byte(`{"version":1,"roles":[],"parameters":{"zoneRedundancy":"maximum"},"partitionSize":1,"stagedRoleChanges":[{"id":"n1","remove":false,"zone":"dc1","capacity":500,"tags":[]}],"stagedParameters":null}`))
	}))
	defer srv.Close()
	cap500 := int64(500)
	got, err := New(srv.URL, "t").UpdateClusterLayout([]NodeRoleChange{{NodeID: "n1", Zone: "dc1", Capacity: &cap500, Tags: []string{}}})
	if err != nil {
		t.Fatal(err)
	}
	if len(got.StagedRoleChanges) != 1 {
		t.Errorf("got %+v", got)
	}
}

func TestPreviewApplyRevertConnect(t *testing.T) {
	var paths []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path)
		switch r.URL.Path {
		case "/v2/PreviewClusterLayoutChanges":
			w.Write([]byte(`{"message":["line1","line2"],"newLayout":{"version":2}}`))
		case "/v2/ApplyClusterLayout":
			var body map[string]int
			b, _ := io.ReadAll(r.Body)
			json.Unmarshal(b, &body)
			if body["version"] != 2 {
				t.Errorf("apply version=%v", body)
			}
			w.Write([]byte(`{"message":["applied"]}`))
		case "/v2/RevertClusterLayout":
			w.Write([]byte(`{"version":1,"roles":[],"parameters":{"zoneRedundancy":"maximum"},"partitionSize":1,"stagedRoleChanges":[],"stagedParameters":null}`))
		case "/v2/ConnectClusterNodes":
			var arr []string
			b, _ := io.ReadAll(r.Body)
			json.Unmarshal(b, &arr)
			if len(arr) != 1 || arr[0] != "n1@1.2.3.4:3901" {
				t.Errorf("connect body=%v", arr)
			}
			w.Write([]byte(`[{"success":true,"error":null}]`))
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()
	c := New(srv.URL, "t")
	prev, err := c.PreviewClusterLayoutChanges()
	if err != nil || len(prev.Message) != 2 {
		t.Fatalf("preview err=%v prev=%+v", err, prev)
	}
	if _, err := c.ApplyClusterLayout(2); err != nil {
		t.Fatal(err)
	}
	if _, err := c.RevertClusterLayout(); err != nil {
		t.Fatal(err)
	}
	res, err := c.ConnectClusterNodes([]string{"n1@1.2.3.4:3901"})
	if err != nil {
		t.Fatal(err)
	}
	if len(res) != 1 || !res[0].Success {
		t.Errorf("connect res=%+v", res)
	}
	want := []string{"/v2/PreviewClusterLayoutChanges", "/v2/ApplyClusterLayout", "/v2/RevertClusterLayout", "/v2/ConnectClusterNodes"}
	for i, p := range want {
		if paths[i] != p {
			t.Errorf("paths[%d]=%q want %q", i, paths[i], p)
		}
	}
}
