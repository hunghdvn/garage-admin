package db

import (
	"database/sql"
	"errors"
)

// Session is a stored login session.
type Session struct {
	Token     string
	UserID    int64
	CreatedAt string
	ExpiresAt string
}

// CreateSession inserts a session row.
func (d *DB) CreateSession(token string, userID int64, expiresAt string) error {
	_, err := d.sql.Exec(
		`INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)`,
		token, userID, nowRFC3339(), expiresAt,
	)
	return err
}

// GetSession fetches a session by token.
func (d *DB) GetSession(token string) (*Session, error) {
	var s Session
	err := d.sql.QueryRow(
		`SELECT token, user_id, created_at, expires_at FROM sessions WHERE token=?`, token,
	).Scan(&s.Token, &s.UserID, &s.CreatedAt, &s.ExpiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &s, nil
}

// DeleteSession removes a session by token.
func (d *DB) DeleteSession(token string) error {
	_, err := d.sql.Exec(`DELETE FROM sessions WHERE token=?`, token)
	return err
}

// DeleteExpiredSessions removes sessions whose expires_at is in the past.
func (d *DB) DeleteExpiredSessions() error {
	_, err := d.sql.Exec(`DELETE FROM sessions WHERE expires_at < ?`, nowRFC3339())
	return err
}
