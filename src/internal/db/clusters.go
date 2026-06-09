package db

import (
	"database/sql"
	"errors"
)

// Cluster is a stored Garage cluster connection. Token/secret fields hold
// already-encrypted values.
type Cluster struct {
	ID             int64
	Name           string
	AdminEndpoint  string
	AdminTokenEnc  string
	S3Endpoint     string
	S3Region       string
	S3AccessKey    string
	S3SecretKeyEnc string
	IsDefault      bool
	CreatedAt      string
	UpdatedAt      string
}

// CreateCluster inserts a cluster. If IsDefault, clears the flag on others.
func (d *DB) CreateCluster(c *Cluster) (*Cluster, error) {
	now := nowRFC3339()
	if c.IsDefault {
		if _, err := d.sql.Exec(`UPDATE clusters SET is_default=0`); err != nil {
			return nil, err
		}
	}
	res, err := d.sql.Exec(
		`INSERT INTO clusters
		 (name, admin_endpoint, admin_token_enc, s3_endpoint, s3_region, s3_access_key, s3_secret_key_enc, is_default, created_at, updated_at)
		 VALUES (?,?,?,?,?,?,?,?,?,?)`,
		c.Name, c.AdminEndpoint, c.AdminTokenEnc, c.S3Endpoint, c.S3Region,
		c.S3AccessKey, c.S3SecretKeyEnc, boolToInt(c.IsDefault), now, now,
	)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	c.ID, c.CreatedAt, c.UpdatedAt = id, now, now
	return c, nil
}

// GetCluster fetches by id.
func (d *DB) GetCluster(id int64) (*Cluster, error) {
	return d.scanCluster(d.sql.QueryRow(clusterSelect+` WHERE id=?`, id))
}

// GetDefaultCluster returns the default cluster, or any cluster if none flagged.
func (d *DB) GetDefaultCluster() (*Cluster, error) {
	c, err := d.scanCluster(d.sql.QueryRow(clusterSelect + ` WHERE is_default=1 LIMIT 1`))
	if errors.Is(err, ErrNotFound) {
		return d.scanCluster(d.sql.QueryRow(clusterSelect + ` ORDER BY id LIMIT 1`))
	}
	return c, err
}

// ListClusters returns all clusters ordered by id.
func (d *DB) ListClusters() ([]Cluster, error) {
	rows, err := d.sql.Query(clusterSelect + ` ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Cluster
	for rows.Next() {
		c, err := scanClusterRows(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *c)
	}
	return out, rows.Err()
}

// UpdateCluster updates all mutable fields.
func (d *DB) UpdateCluster(c *Cluster) error {
	if c.IsDefault {
		if _, err := d.sql.Exec(`UPDATE clusters SET is_default=0 WHERE id<>?`, c.ID); err != nil {
			return err
		}
	}
	_, err := d.sql.Exec(
		`UPDATE clusters SET name=?, admin_endpoint=?, admin_token_enc=?, s3_endpoint=?,
		 s3_region=?, s3_access_key=?, s3_secret_key_enc=?, is_default=?, updated_at=? WHERE id=?`,
		c.Name, c.AdminEndpoint, c.AdminTokenEnc, c.S3Endpoint, c.S3Region,
		c.S3AccessKey, c.S3SecretKeyEnc, boolToInt(c.IsDefault), nowRFC3339(), c.ID,
	)
	return err
}

// DeleteCluster removes a cluster.
func (d *DB) DeleteCluster(id int64) error {
	_, err := d.sql.Exec(`DELETE FROM clusters WHERE id=?`, id)
	return err
}

const clusterSelect = `SELECT id, name, admin_endpoint, admin_token_enc, s3_endpoint,
	s3_region, s3_access_key, s3_secret_key_enc, is_default, created_at, updated_at FROM clusters`

func (d *DB) scanCluster(row *sql.Row) (*Cluster, error) {
	var c Cluster
	var def int
	err := row.Scan(&c.ID, &c.Name, &c.AdminEndpoint, &c.AdminTokenEnc, &c.S3Endpoint,
		&c.S3Region, &c.S3AccessKey, &c.S3SecretKeyEnc, &def, &c.CreatedAt, &c.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	c.IsDefault = def == 1
	return &c, nil
}

func scanClusterRows(rows *sql.Rows) (*Cluster, error) {
	var c Cluster
	var def int
	err := rows.Scan(&c.ID, &c.Name, &c.AdminEndpoint, &c.AdminTokenEnc, &c.S3Endpoint,
		&c.S3Region, &c.S3AccessKey, &c.S3SecretKeyEnc, &def, &c.CreatedAt, &c.UpdatedAt)
	if err != nil {
		return nil, err
	}
	c.IsDefault = def == 1
	return &c, nil
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
