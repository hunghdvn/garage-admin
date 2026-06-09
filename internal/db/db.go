// Package db opens the SQLite database and runs embedded migrations.
package db

import (
	"database/sql"
	"embed"
	"fmt"
	"sort"

	_ "modernc.org/sqlite"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

// DB wraps the SQL connection.
type DB struct {
	sql *sql.DB
}

// Open opens (creating if needed) the SQLite database and applies migrations.
func Open(path string) (*DB, error) {
	conn, err := sql.Open("sqlite", path+"?_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)")
	if err != nil {
		return nil, err
	}
	conn.SetMaxOpenConns(1) // SQLite: single writer avoids lock churn on low-RAM NAS
	d := &DB{sql: conn}
	if err := d.migrate(); err != nil {
		conn.Close()
		return nil, err
	}
	return d, nil
}

// SQL exposes the underlying *sql.DB for repositories.
func (d *DB) SQL() *sql.DB { return d.sql }

// Close closes the connection.
func (d *DB) Close() error { return d.sql.Close() }

func (d *DB) migrate() error {
	entries, err := migrationsFS.ReadDir("migrations")
	if err != nil {
		return err
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		names = append(names, e.Name())
	}
	sort.Strings(names)
	for _, name := range names {
		content, err := migrationsFS.ReadFile("migrations/" + name)
		if err != nil {
			return err
		}
		if _, err := d.sql.Exec(string(content)); err != nil {
			return fmt.Errorf("migration %s: %w", name, err)
		}
	}
	return nil
}
