package garage

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Bodies below are trimmed copies of real Garage v2.5.0 responses.

func TestListBucketsInfo(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v2/ListBucketsInfo" {
			t.Errorf("path=%q", r.URL.Path)
		}
		w.Write([]byte(`[{"id":"b1","created":"2026-11-12T06:28:45.197Z","globalAliases":["files"],"websiteAccess":false,
			"keys":[{"accessKeyId":"GK1","name":"main","permissions":{"read":true,"write":true,"owner":true},"bucketLocalAliases":[]}],
			"objects":7,"bytes":1234,"unfinishedUploads":0,"unfinishedMultipartUploads":0,"unfinishedMultipartUploadParts":0,"unfinishedMultipartUploadBytes":0,
			"quotas":{"maxSize":5000,"maxObjects":null}}]`))
	}))
	defer srv.Close()

	got, err := New(srv.URL, "t").ListBucketsInfo()
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].ID != "b1" || got[0].Objects != 7 || got[0].Bytes != 1234 ||
		len(got[0].Keys) != 1 || got[0].Quotas.MaxSize == nil || *got[0].Quotas.MaxSize != 5000 {
		t.Errorf("got %+v", got)
	}
}

func TestListKeysInfo(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v2/ListKeysInfo" {
			t.Errorf("path=%q", r.URL.Path)
		}
		w.Write([]byte(`[{"accessKeyId":"GK1","created":"2026-11-12T06:30:34.707Z","name":"main","expiration":null,"expired":false,
			"permissions":{"createBucket":true},
			"buckets":[{"id":"b1","globalAliases":["files"],"localAliases":[],"permissions":{"read":true,"write":true,"owner":true}}]}]`))
	}))
	defer srv.Close()

	got, err := New(srv.URL, "t").ListKeysInfo()
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].AccessKeyID != "GK1" || !got[0].Permissions.CreateBucket ||
		len(got[0].Buckets) != 1 || got[0].Buckets[0].GlobalAliases[0] != "files" {
		t.Errorf("got %+v", got)
	}
}

const layoutStats = `{"replicationFactor":1,"effectiveZoneRedundancy":1,"partitionSize":2539062500,"previousPartitionSize":null,
	"lowPartitionSize":false,"usableCapacity":650000000000,"totalCapacity":650000000000,"effectiveCapacity":650000000000,
	"lowUsableCapacity":false,"totalMovedPartitions":256,
	"zones":[{"name":"dc1","totalReplicatedPartitions":256,"uniquePartitions":256,"totalCapacity":650000000000,"usableCapacity":650000000000,
		"nodes":[{"id":"n1","tags":[],"storedPartitions":256,"newPartitions":256,"totalCapacity":650000000000,"usableCapacity":650000000000}]}]}`

// The layout endpoints are proxied to the web UI as-is, so what matters is that
// the structured statistics (added in Garage v2.4) survive the round trip.
func TestLayoutPreviewAndApplyKeepStatistics(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v2/PreviewClusterLayoutChanges":
			w.Write([]byte(`{"message":["ok"],"newLayout":{"version":2},"statistics":` + layoutStats + `}`))
		case "/v2/ApplyClusterLayout":
			w.Write([]byte(`{"message":["ok"],"layout":{"version":2},"statistics":` + layoutStats + `}`))
		default:
			t.Errorf("path=%q", r.URL.Path)
		}
	}))
	defer srv.Close()
	c := New(srv.URL, "t")

	prev, err := c.PreviewClusterLayoutChanges()
	if err != nil {
		t.Fatal(err)
	}
	applied, err := c.ApplyClusterLayout(2)
	if err != nil {
		t.Fatal(err)
	}
	for name, v := range map[string]any{"preview": prev, "apply": applied} {
		out, _ := json.Marshal(v)
		if !strings.Contains(string(out), `"effectiveZoneRedundancy":1`) || !strings.Contains(string(out), `"totalMovedPartitions":256`) {
			t.Errorf("%s dropped statistics: %s", name, out)
		}
	}
	if out, _ := json.Marshal(applied); !strings.Contains(string(out), `"layout":{"version":2}`) {
		t.Errorf("apply dropped layout: %s", out)
	}
}
