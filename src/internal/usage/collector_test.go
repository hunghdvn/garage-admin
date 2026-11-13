package usage

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/HungHD/garage-admin/internal/crypto"
	"github.com/HungHD/garage-admin/internal/db"
)

func fakeGarage(t *testing.T) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v2/GetClusterStatistics":
			w.Write([]byte(`{"freeform":"","dataAvail":9000,"metadataAvail":1,"incompleteAvailInfo":false,
				"bucketCount":1,"totalObjectCount":5,"totalObjectBytes":1000}`))
		case "/v2/ListBucketsInfo":
			w.Write([]byte(`[{"id":"b1","globalAliases":["files"],"objects":5,"bytes":1000}]`))
		default:
			t.Errorf("unexpected call %s", r.URL.Path)
			w.WriteHeader(http.StatusInternalServerError)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

func newCollector(t *testing.T, now time.Time) (*Collector, *db.DB, *crypto.Cipher) {
	t.Helper()
	d, err := db.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	cph, _ := crypto.New([]byte("0123456789abcdef0123456789abcdef"))
	return &Collector{DB: d, Cipher: cph, Now: func() time.Time { return now }}, d, cph
}

func addCluster(t *testing.T, d *db.DB, cph *crypto.Cipher, name, endpoint string) int64 {
	t.Helper()
	enc, _ := cph.Encrypt("tok")
	c, err := d.CreateCluster(&db.Cluster{Name: name, AdminEndpoint: endpoint, AdminTokenEnc: enc})
	if err != nil {
		t.Fatal(err)
	}
	return c.ID
}

func TestCollectOnceRecordsClusterAndBuckets(t *testing.T) {
	now := mustTime(t, "2026-11-13T10:25:00Z")
	c, d, cph := newCollector(t, now)
	id := addCluster(t, d, cph, "nas", fakeGarage(t).URL)

	c.CollectOnce()

	hour := mustTime(t, "2026-11-13T10:00:00Z").Unix()
	cu, err := d.ClusterUsageSince(id, 0)
	if err != nil {
		t.Fatal(err)
	}
	if want := []db.ClusterUsage{{TS: hour, Bytes: 1000, Objects: 5, DataAvail: 9000, BucketCount: 1}}; !reflect.DeepEqual(cu, want) {
		t.Errorf("cluster usage = %+v, want %+v", cu, want)
	}
	bu, err := d.BucketUsageSince(id, "b1", 0)
	if err != nil {
		t.Fatal(err)
	}
	if want := []db.BucketUsage{{BucketID: "b1", TS: hour, Alias: "files", Bytes: 1000, Objects: 5}}; !reflect.DeepEqual(bu, want) {
		t.Errorf("bucket usage = %+v, want %+v", bu, want)
	}
}

func TestCollectSkipsFailingCluster(t *testing.T) {
	c, d, cph := newCollector(t, mustTime(t, "2026-11-13T10:25:00Z"))
	dead := httptest.NewServer(http.NotFoundHandler())
	dead.Close() // connection refused
	a := addCluster(t, d, cph, "down", dead.URL)
	b := addCluster(t, d, cph, "up", fakeGarage(t).URL)

	c.CollectOnce()

	if rows, _ := d.ClusterUsageSince(a, 0); len(rows) != 0 {
		t.Errorf("failing cluster got rows: %+v", rows)
	}
	if rows, _ := d.ClusterUsageSince(b, 0); len(rows) != 1 {
		t.Errorf("healthy cluster rows = %+v", rows)
	}
}

func TestCollectOnceCompactsOldRows(t *testing.T) {
	now := mustTime(t, "2026-11-13T10:25:00Z")
	c, d, cph := newCollector(t, now)
	id := addCluster(t, d, cph, "nas", fakeGarage(t).URL)
	// Two snapshots on a UTC day 40 days ago: only the later survives.
	day := now.Add(-40 * 24 * time.Hour).Truncate(24 * time.Hour)
	d.SaveClusterUsage(id, db.ClusterUsage{TS: day.Add(1 * time.Hour).Unix()})
	d.SaveClusterUsage(id, db.ClusterUsage{TS: day.Add(5 * time.Hour).Unix()})

	c.CollectOnce()

	rows, _ := d.ClusterUsageSince(id, 0)
	if len(rows) != 2 || rows[0].TS != day.Add(5*time.Hour).Unix() {
		t.Fatalf("rows = %+v", rows)
	}
}
