package db

import (
	"testing"
	"time"
)

func TestCreateGetDeleteSession(t *testing.T) {
	d := newTestDB(t)
	u, _ := d.CreateUser("alice", "h", "admin")
	exp := time.Now().Add(time.Hour).UTC().Format(time.RFC3339)

	if err := d.CreateSession("tok-123", u.ID, exp); err != nil {
		t.Fatal(err)
	}
	got, err := d.GetSession("tok-123")
	if err != nil {
		t.Fatal(err)
	}
	if got.UserID != u.ID {
		t.Errorf("UserID = %d, want %d", got.UserID, u.ID)
	}
	if err := d.DeleteSession("tok-123"); err != nil {
		t.Fatal(err)
	}
	if _, err := d.GetSession("tok-123"); err == nil {
		t.Error("expected session gone")
	}
}

func TestDeleteExpiredSessions(t *testing.T) {
	d := newTestDB(t)
	u, _ := d.CreateUser("a", "h", "admin")
	past := time.Now().Add(-time.Hour).UTC().Format(time.RFC3339)
	future := time.Now().Add(time.Hour).UTC().Format(time.RFC3339)
	d.CreateSession("old", u.ID, past)
	d.CreateSession("new", u.ID, future)

	if err := d.DeleteExpiredSessions(); err != nil {
		t.Fatal(err)
	}
	if _, err := d.GetSession("old"); err == nil {
		t.Error("expected expired session removed")
	}
	if _, err := d.GetSession("new"); err != nil {
		t.Error("expected valid session kept")
	}
}

func TestSessionTokenStoredHashed(t *testing.T) {
	d := newTestDB(t)
	u, _ := d.CreateUser("alice", "h", "admin")
	exp := time.Now().Add(time.Hour).UTC().Format(time.RFC3339)
	d.CreateSession("raw-token", u.ID, exp)
	var stored string
	if err := d.SQL().QueryRow(`SELECT token FROM sessions`).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if stored == "raw-token" || stored != hashToken("raw-token") || len(stored) != 64 {
		t.Errorf("stored token = %q, want sha256 hex", stored)
	}
	// A legacy plaintext row must not match its own value as a lookup key.
	d.SQL().Exec(`INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES ('legacy', ?, 'x', ?)`, u.ID, exp)
	if _, err := d.GetSession("legacy"); err == nil {
		t.Error("legacy plaintext session should no longer match")
	}
}

func TestDeleteUserSessions(t *testing.T) {
	d := newTestDB(t)
	a, _ := d.CreateUser("a", "h", "admin")
	b, _ := d.CreateUser("b", "h", "admin")
	exp := time.Now().Add(time.Hour).UTC().Format(time.RFC3339)
	d.CreateSession("a1", a.ID, exp)
	d.CreateSession("a2", a.ID, exp)
	d.CreateSession("b1", b.ID, exp)

	if err := d.DeleteUserSessionsExcept(a.ID, "a1"); err != nil {
		t.Fatal(err)
	}
	if _, err := d.GetSession("a1"); err != nil {
		t.Error("a1 should be kept")
	}
	if _, err := d.GetSession("a2"); err == nil {
		t.Error("a2 should be deleted")
	}
	if _, err := d.GetSession("b1"); err != nil {
		t.Error("other user's session should be kept")
	}
	if err := d.DeleteUserSessions(a.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := d.GetSession("a1"); err == nil {
		t.Error("a1 should be deleted")
	}
}
