package db

import (
	"database/sql"
	"errors"
	"time"
)

// User is an admin-panel user account.
type User struct {
	ID           int64
	Username     string
	PasswordHash string
	Role         string
	CreatedAt    string
	UpdatedAt    string
}

// ErrNotFound is returned when a row does not exist.
var ErrNotFound = errors.New("not found")

func nowRFC3339() string { return time.Now().UTC().Format(time.RFC3339) }

// CreateUser inserts a new user.
func (d *DB) CreateUser(username, passwordHash, role string) (*User, error) {
	now := nowRFC3339()
	res, err := d.sql.Exec(
		`INSERT INTO users (username, password_hash, role, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?)`,
		username, passwordHash, role, now, now,
	)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return &User{ID: id, Username: username, PasswordHash: passwordHash, Role: role, CreatedAt: now, UpdatedAt: now}, nil
}

// GetUserByUsername fetches a user by username.
func (d *DB) GetUserByUsername(username string) (*User, error) {
	return d.scanUser(d.sql.QueryRow(
		`SELECT id, username, password_hash, role, created_at, updated_at FROM users WHERE username=?`, username))
}

// GetUserByID fetches a user by id.
func (d *DB) GetUserByID(id int64) (*User, error) {
	return d.scanUser(d.sql.QueryRow(
		`SELECT id, username, password_hash, role, created_at, updated_at FROM users WHERE id=?`, id))
}

func (d *DB) scanUser(row *sql.Row) (*User, error) {
	var u User
	err := row.Scan(&u.ID, &u.Username, &u.PasswordHash, &u.Role, &u.CreatedAt, &u.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// ListUsers returns all users ordered by id.
func (d *DB) ListUsers() ([]User, error) {
	rows, err := d.sql.Query(
		`SELECT id, username, password_hash, role, created_at, updated_at FROM users ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []User
	for rows.Next() {
		var u User
		if err := rows.Scan(&u.ID, &u.Username, &u.PasswordHash, &u.Role, &u.CreatedAt, &u.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

// CountUsers returns the number of users.
func (d *DB) CountUsers() (int, error) {
	var n int
	err := d.sql.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&n)
	return n, err
}

// DeleteUser removes a user by id.
func (d *DB) DeleteUser(id int64) error {
	_, err := d.sql.Exec(`DELETE FROM users WHERE id=?`, id)
	return err
}

// UpdateUserRole sets a user's role.
func (d *DB) UpdateUserRole(id int64, role string) error {
	_, err := d.sql.Exec(`UPDATE users SET role=?, updated_at=? WHERE id=?`, role, nowRFC3339(), id)
	return err
}

// UpdateUserPassword sets a user's password hash.
func (d *DB) UpdateUserPassword(id int64, passwordHash string) error {
	_, err := d.sql.Exec(`UPDATE users SET password_hash=?, updated_at=? WHERE id=?`, passwordHash, nowRFC3339(), id)
	return err
}

// CountAdmins returns the number of users with the admin role.
func (d *DB) CountAdmins() (int, error) {
	var n int
	err := d.sql.QueryRow(`SELECT COUNT(*) FROM users WHERE role='admin'`).Scan(&n)
	return n, err
}
