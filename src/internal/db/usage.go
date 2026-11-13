package db

// ClusterUsage is one cluster-wide usage snapshot.
type ClusterUsage struct {
	TS          int64 `json:"ts"`
	Bytes       int64 `json:"bytes"`
	Objects     int64 `json:"objects"`
	DataAvail   int64 `json:"dataAvail"`
	BucketCount int64 `json:"bucketCount"`
}

// BucketUsage is one per-bucket usage snapshot.
type BucketUsage struct {
	BucketID string `json:"-"`
	TS       int64  `json:"ts"`
	Alias    string `json:"alias"`
	Bytes    int64  `json:"bytes"`
	Objects  int64  `json:"objects"`
}

// SaveClusterUsage inserts a snapshot, replacing any existing one for the same ts.
func (d *DB) SaveClusterUsage(clusterID int64, u ClusterUsage) error {
	_, err := d.sql.Exec(
		`INSERT INTO cluster_usage (cluster_id, ts, bytes, objects, data_avail, bucket_count)
		 VALUES (?,?,?,?,?,?)
		 ON CONFLICT (cluster_id, ts) DO UPDATE SET
		   bytes=excluded.bytes, objects=excluded.objects,
		   data_avail=excluded.data_avail, bucket_count=excluded.bucket_count`,
		clusterID, u.TS, u.Bytes, u.Objects, u.DataAvail, u.BucketCount,
	)
	return err
}

// SaveBucketUsage upserts per-bucket snapshots in one transaction.
func (d *DB) SaveBucketUsage(clusterID int64, rows []BucketUsage) error {
	tx, err := d.sql.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	stmt, err := tx.Prepare(
		`INSERT INTO bucket_usage (cluster_id, bucket_id, ts, alias, bytes, objects)
		 VALUES (?,?,?,?,?,?)
		 ON CONFLICT (cluster_id, bucket_id, ts) DO UPDATE SET
		   alias=excluded.alias, bytes=excluded.bytes, objects=excluded.objects`)
	if err != nil {
		return err
	}
	defer stmt.Close()
	for _, r := range rows {
		if _, err := stmt.Exec(clusterID, r.BucketID, r.TS, r.Alias, r.Bytes, r.Objects); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// ClusterUsageSince returns snapshots with ts >= since, oldest first.
func (d *DB) ClusterUsageSince(clusterID, since int64) ([]ClusterUsage, error) {
	rows, err := d.sql.Query(
		`SELECT ts, bytes, objects, data_avail, bucket_count FROM cluster_usage
		 WHERE cluster_id=? AND ts>=? ORDER BY ts`, clusterID, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ClusterUsage
	for rows.Next() {
		var u ClusterUsage
		if err := rows.Scan(&u.TS, &u.Bytes, &u.Objects, &u.DataAvail, &u.BucketCount); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

// BucketUsageSince returns one bucket's snapshots with ts >= since, oldest first.
func (d *DB) BucketUsageSince(clusterID int64, bucketID string, since int64) ([]BucketUsage, error) {
	rows, err := d.sql.Query(
		`SELECT bucket_id, ts, alias, bytes, objects FROM bucket_usage
		 WHERE cluster_id=? AND bucket_id=? AND ts>=? ORDER BY ts`, clusterID, bucketID, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []BucketUsage
	for rows.Next() {
		var u BucketUsage
		if err := rows.Scan(&u.BucketID, &u.TS, &u.Alias, &u.Bytes, &u.Objects); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

// CompactUsage thins snapshots older than cutoff down to the last one of each
// UTC day (per cluster, and per bucket).
func (d *DB) CompactUsage(cutoff int64) error {
	if _, err := d.sql.Exec(
		`DELETE FROM cluster_usage WHERE ts < ?1 AND EXISTS (
		   SELECT 1 FROM cluster_usage v
		   WHERE v.cluster_id = cluster_usage.cluster_id AND v.ts < ?1
		     AND v.ts/86400 = cluster_usage.ts/86400 AND v.ts > cluster_usage.ts)`, cutoff); err != nil {
		return err
	}
	_, err := d.sql.Exec(
		`DELETE FROM bucket_usage WHERE ts < ?1 AND EXISTS (
		   SELECT 1 FROM bucket_usage v
		   WHERE v.cluster_id = bucket_usage.cluster_id AND v.bucket_id = bucket_usage.bucket_id
		     AND v.ts < ?1 AND v.ts/86400 = bucket_usage.ts/86400 AND v.ts > bucket_usage.ts)`, cutoff)
	return err
}
