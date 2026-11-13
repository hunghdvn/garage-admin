package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/HungHD/garage-admin/internal/auth"
	"github.com/HungHD/garage-admin/internal/crypto"
	"github.com/HungHD/garage-admin/internal/db"
)

// newUsageAPI returns a readonly session on a server with one default cluster,
// plus the DB handle and cluster id for seeding usage rows.
func newUsageAPI(t *testing.T) (http.Handler, *http.Cookie, *db.DB, int64) {
	t.Helper()
	d, err := db.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	hash, _ := auth.HashPassword("pw")
	d.CreateUser("u", hash, "readonly")
	cph, _ := crypto.New([]byte("0123456789abcdef0123456789abcdef"))
	enc, _ := cph.Encrypt("tok")
	c, err := d.CreateCluster(&db.Cluster{Name: "c", AdminEndpoint: "http://127.0.0.1:1", AdminTokenEnc: enc, IsDefault: true})
	if err != nil {
		t.Fatal(err)
	}
	r := (&Server{DB: d, Auth: auth.NewService(d), Cipher: cph}).Routes()
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest("POST", "/api/auth/login", strings.NewReader(`{"username":"u","password":"pw"}`)))
	return r, rec.Result().Cookies()[0], d, c.ID
}

type usageResp struct {
	Granularity string           `json:"granularity"`
	Points      []map[string]any `json:"points"`
}

func getUsage(t *testing.T, r http.Handler, cookie *http.Cookie, path string) (int, usageResp, string) {
	t.Helper()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", path, nil)
	req.AddCookie(cookie)
	r.ServeHTTP(rec, req)
	var out usageResp
	if rec.Code == http.StatusOK {
		if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
			t.Fatalf("%s: %v body=%s", path, err, rec.Body.String())
		}
	}
	return rec.Code, out, rec.Body.String()
}

func TestUsageCluster24hHourly(t *testing.T) {
	r, cookie, d, id := newUsageAPI(t)
	now := time.Now()
	d.SaveClusterUsage(id, db.ClusterUsage{TS: now.Add(-1 * time.Hour).Truncate(time.Hour).Unix(), Bytes: 1, DataAvail: 7})
	d.SaveClusterUsage(id, db.ClusterUsage{TS: now.Add(-30 * time.Hour).Truncate(time.Hour).Unix(), Bytes: 2})

	code, got, body := getUsage(t, r, cookie, "/api/usage/cluster?range=24h&tzOffset=420")
	if code != http.StatusOK {
		t.Fatalf("code=%d body=%s", code, body)
	}
	if got.Granularity != "hour" || len(got.Points) != 1 || got.Points[0]["bytes"] != float64(1) || got.Points[0]["dataAvail"] != float64(7) {
		t.Fatalf("got %+v", got)
	}
}

func TestUsageCluster7dDaily(t *testing.T) {
	r, cookie, d, id := newUsageAPI(t)
	const off = 420 * 60
	now := time.Now().Unix()
	todayStart := (now+off)/86400*86400 - off
	D := todayStart - 2*86400
	for i, ts := range []int64{D - 23*3600, D + 3600, D + 2*3600, D + 3*3600} {
		d.SaveClusterUsage(id, db.ClusterUsage{TS: ts, Bytes: int64(i)})
	}

	code, got, body := getUsage(t, r, cookie, "/api/usage/cluster?range=7d&tzOffset=420")
	if code != http.StatusOK {
		t.Fatalf("code=%d body=%s", code, body)
	}
	if got.Granularity != "day" || len(got.Points) != 2 {
		t.Fatalf("got %+v", got)
	}
	if got.Points[0]["bytes"] != float64(0) || got.Points[1]["bytes"] != float64(3) {
		t.Fatalf("points = %+v", got.Points)
	}
}

func TestUsageBucketScopedToBucket(t *testing.T) {
	r, cookie, d, id := newUsageAPI(t)
	ts := time.Now().Add(-time.Hour).Truncate(time.Hour).Unix()
	d.SaveBucketUsage(id, []db.BucketUsage{
		{BucketID: "b1", TS: ts, Alias: "files", Bytes: 11, Objects: 1},
		{BucketID: "b2", TS: ts, Bytes: 22},
	})

	code, got, body := getUsage(t, r, cookie, "/api/usage/buckets/b1?range=7d")
	if code != http.StatusOK {
		t.Fatalf("code=%d body=%s", code, body)
	}
	if len(got.Points) != 1 || got.Points[0]["bytes"] != float64(11) || got.Points[0]["alias"] != "files" {
		t.Fatalf("got %+v", got)
	}
	if _, leaked := got.Points[0]["BucketID"]; leaked {
		t.Errorf("bucket id field leaked: %+v", got.Points[0])
	}
}

func TestUsageRejectsBadRange(t *testing.T) {
	r, cookie, _, _ := newUsageAPI(t)
	for _, path := range []string{
		"/api/usage/cluster?range=2d",
		"/api/usage/cluster?range=7d&tzOffset=abc",
		"/api/usage/cluster?range=7d&tzOffset=900",
		"/api/usage/buckets/b1?range=2d",
	} {
		if code, _, body := getUsage(t, r, cookie, path); code != http.StatusBadRequest {
			t.Errorf("%s: code=%d body=%s", path, code, body)
		}
	}
}

func TestUsageEmptyIsArray(t *testing.T) {
	r, cookie, _, _ := newUsageAPI(t)
	for _, path := range []string{"/api/usage/cluster?range=30d", "/api/usage/buckets/none?range=24h"} {
		code, _, body := getUsage(t, r, cookie, path)
		if code != http.StatusOK || !strings.Contains(body, `"points":[]`) {
			t.Errorf("%s: code=%d body=%s", path, code, body)
		}
	}
}

func TestUsageRequiresLogin(t *testing.T) {
	r, _, _, _ := newUsageAPI(t)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest("GET", "/api/usage/cluster?range=24h", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("code=%d", rec.Code)
	}
}
