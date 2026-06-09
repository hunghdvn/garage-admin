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
