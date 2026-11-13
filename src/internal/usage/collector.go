package usage

import (
	"context"
	"log"
	"time"

	"github.com/HungHD/garage-admin/internal/crypto"
	"github.com/HungHD/garage-admin/internal/db"
	"github.com/HungHD/garage-admin/internal/garage"
)

// hourlyRetention is how long hourly snapshots are kept before being thinned
// to one per UTC day.
const hourlyRetention = 31 * 24 * time.Hour

// Collector snapshots usage of every configured cluster once per hour.
type Collector struct {
	DB     *db.DB
	Cipher *crypto.Cipher
	Now    func() time.Time // nil → time.Now
}

func (c *Collector) now() time.Time {
	if c.Now != nil {
		return c.Now()
	}
	return time.Now()
}

// Run collects immediately, then at every full hour until ctx is done.
func (c *Collector) Run(ctx context.Context) {
	for {
		c.CollectOnce()
		select {
		case <-ctx.Done():
			return
		case <-time.After(UntilNextHour(time.Now())):
		}
	}
}

// CollectOnce records one snapshot per cluster for the current hour, then
// compacts snapshots older than the hourly retention window. A cluster that
// cannot be reached is logged and skipped.
func (c *Collector) CollectOnce() {
	now := c.now().UTC()
	ts := now.Truncate(time.Hour).Unix()
	clusters, err := c.DB.ListClusters()
	if err != nil {
		log.Printf("usage: list clusters: %v", err)
		return
	}
	for i := range clusters {
		cl := &clusters[i]
		if err := c.collectCluster(cl, ts); err != nil {
			log.Printf("usage: cluster %d (%s): %v", cl.ID, cl.Name, err)
		}
	}
	cutoff := now.Add(-hourlyRetention).Truncate(24 * time.Hour).Unix()
	if err := c.DB.CompactUsage(cutoff); err != nil {
		log.Printf("usage: compact: %v", err)
	}
}

func (c *Collector) collectCluster(cl *db.Cluster, ts int64) error {
	token, err := c.Cipher.Decrypt(cl.AdminTokenEnc)
	if err != nil {
		return err
	}
	client := garage.New(cl.AdminEndpoint, token)

	stats, err := client.GetClusterStatistics()
	if err != nil {
		return err
	}
	if err := c.DB.SaveClusterUsage(cl.ID, db.ClusterUsage{
		TS:          ts,
		Bytes:       stats.TotalObjectBytes,
		Objects:     stats.TotalObjectCount,
		DataAvail:   stats.DataAvail,
		BucketCount: stats.BucketCount,
	}); err != nil {
		return err
	}

	buckets, err := client.ListBucketsDetailed()
	if err != nil {
		return err
	}
	rows := make([]db.BucketUsage, 0, len(buckets))
	for _, b := range buckets {
		alias := ""
		if len(b.GlobalAliases) > 0 {
			alias = b.GlobalAliases[0]
		}
		rows = append(rows, db.BucketUsage{BucketID: b.ID, TS: ts, Alias: alias, Bytes: b.Bytes, Objects: b.Objects})
	}
	return c.DB.SaveBucketUsage(cl.ID, rows)
}
