package db

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
)

// Session is a stored login session.
type Session struct {
	Token     string
	UserID    int64
	CreatedAt string
	ExpiresAt string
}

// hashToken is what is stored in sessions.token: the cookie holds the raw
// token, so a leaked database cannot be replayed as live sessions.
func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// CreateSession inserts a session row.
func (d *DB) CreateSession(token string, userID int64, expiresAt string) error {
	_, err := d.sql.Exec(
		`INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)`,
		hashToken(token), userID, nowRFC3339(), expiresAt,
	)
	return err
}

// GetSession fetches a session by token.
func (d *DB) GetSession(token string) (*Session, error) {
	var s Session
	err := d.sql.QueryRow(
		`SELECT token, user_id, created_at, expires_at FROM sessions WHERE token=?`, hashToken(token),
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
	_, err := d.sql.Exec(`DELETE FROM sessions WHERE token=?`, hashToken(token))
	return err
}

// DeleteExpiredSessions removes sessions whose expires_at is in the past.
func (d *DB) DeleteExpiredSessions() error {
	_, err := d.sql.Exec(`DELETE FROM sessions WHERE expires_at < ?`, nowRFC3339())
	return err
}

// DeleteUserSessions removes all sessions of a user.
func (d *DB) DeleteUserSessions(userID int64) error {
	_, err := d.sql.Exec(`DELETE FROM sessions WHERE user_id=?`, userID)
	return err
}

// DeleteUserSessionsExcept removes all of a user's sessions except the one for
// keepToken (raw cookie token; empty keeps none).
func (d *DB) DeleteUserSessionsExcept(userID int64, keepToken string) error {
	_, err := d.sql.Exec(`DELETE FROM sessions WHERE user_id=? AND token<>?`, userID, hashToken(keepToken))
	return err
}
