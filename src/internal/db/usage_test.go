package db

import (
	"reflect"
	"testing"
)

func usageCluster(t *testing.T, d *DB) int64 {
	t.Helper()
	c, err := d.CreateCluster(sampleCluster())
	if err != nil {
		t.Fatal(err)
	}
	return c.ID
}

func clusterTS(t *testing.T, d *DB, id, since int64) []int64 {
	t.Helper()
	rows, err := d.ClusterUsageSince(id, since)
	if err != nil {
		t.Fatal(err)
	}
	out := []int64{}
	for _, r := range rows {
		out = append(out, r.TS)
	}
	return out
}

func bucketTS(t *testing.T, d *DB, id int64, bucket string, since int64) []int64 {
	t.Helper()
	rows, err := d.BucketUsageSince(id, bucket, since)
	if err != nil {
		t.Fatal(err)
	}
	out := []int64{}
	for _, r := range rows {
		out = append(out, r.TS)
	}
	return out
}

func TestSaveClusterUsageUpsertsSameHour(t *testing.T) {
	d := newTestDB(t)
	id := usageCluster(t, d)
	if err := d.SaveClusterUsage(id, ClusterUsage{TS: 3600, Bytes: 10}); err != nil {
		t.Fatal(err)
	}
	if err := d.SaveClusterUsage(id, ClusterUsage{TS: 3600, Bytes: 20, Objects: 2, DataAvail: 5, BucketCount: 1}); err != nil {
		t.Fatal(err)
	}
	rows, err := d.ClusterUsageSince(id, 0)
	if err != nil {
		t.Fatal(err)
	}
	want := []ClusterUsage{{TS: 3600, Bytes: 20, Objects: 2, DataAvail: 5, BucketCount: 1}}
	if !reflect.DeepEqual(rows, want) {
		t.Fatalf("rows = %+v, want %+v", rows, want)
	}
}

func TestClusterUsageSinceFiltersAndOrders(t *testing.T) {
	d := newTestDB(t)
	id := usageCluster(t, d)
	for _, ts := range []int64{7200, 0, 3600} {
		if err := d.SaveClusterUsage(id, ClusterUsage{TS: ts}); err != nil {
			t.Fatal(err)
		}
	}
	if got := clusterTS(t, d, id, 3600); !reflect.DeepEqual(got, []int64{3600, 7200}) {
		t.Fatalf("ts = %v", got)
	}
}

func TestBucketUsageIsPerBucket(t *testing.T) {
	d := newTestDB(t)
	id := usageCluster(t, d)
	err := d.SaveBucketUsage(id, []BucketUsage{
		{BucketID: "b1", TS: 0, Alias: "files", Bytes: 1, Objects: 3},
		{BucketID: "b2", TS: 0, Bytes: 2},
	})
	if err != nil {
		t.Fatal(err)
	}
	rows, err := d.BucketUsageSince(id, "b1", 0)
	if err != nil {
		t.Fatal(err)
	}
	want := []BucketUsage{{BucketID: "b1", TS: 0, Alias: "files", Bytes: 1, Objects: 3}}
	if !reflect.DeepEqual(rows, want) {
		t.Fatalf("rows = %+v, want %+v", rows, want)
	}
	// Same hour again replaces, never duplicates.
	if err := d.SaveBucketUsage(id, []BucketUsage{{BucketID: "b1", TS: 0, Alias: "files", Bytes: 9}}); err != nil {
		t.Fatal(err)
	}
	rows, _ = d.BucketUsageSince(id, "b1", 0)
	if len(rows) != 1 || rows[0].Bytes != 9 {
		t.Fatalf("after upsert rows = %+v", rows)
	}
}

func TestCompactUsageKeepsLastRowPerUTCDay(t *testing.T) {
	d := newTestDB(t)
	id := usageCluster(t, d)
	all := []int64{0, 3600, 82800, 86400, 90000}
	for _, ts := range all {
		if err := d.SaveClusterUsage(id, ClusterUsage{TS: ts}); err != nil {
			t.Fatal(err)
		}
		if err := d.SaveBucketUsage(id, []BucketUsage{{BucketID: "b1", TS: ts}, {BucketID: "b2", TS: ts}}); err != nil {
			t.Fatal(err)
		}
	}
	if err := d.CompactUsage(86400); err != nil {
		t.Fatal(err)
	}
	want := []int64{82800, 86400, 90000}
	if got := clusterTS(t, d, id, 0); !reflect.DeepEqual(got, want) {
		t.Errorf("cluster ts = %v, want %v", got, want)
	}
	for _, b := range []string{"b1", "b2"} {
		if got := bucketTS(t, d, id, b, 0); !reflect.DeepEqual(got, want) {
			t.Errorf("bucket %s ts = %v, want %v", b, got, want)
		}
	}
}

func TestUsageDeletedWithCluster(t *testing.T) {
	d := newTestDB(t)
	id := usageCluster(t, d)
	if err := d.SaveClusterUsage(id, ClusterUsage{TS: 0}); err != nil {
		t.Fatal(err)
	}
	if err := d.SaveBucketUsage(id, []BucketUsage{{BucketID: "b1", TS: 0}}); err != nil {
		t.Fatal(err)
	}
	if err := d.DeleteCluster(id); err != nil {
		t.Fatal(err)
	}
	if got := clusterTS(t, d, id, 0); len(got) != 0 {
		t.Errorf("cluster usage left: %v", got)
	}
	if got := bucketTS(t, d, id, "b1", 0); len(got) != 0 {
		t.Errorf("bucket usage left: %v", got)
	}
}
