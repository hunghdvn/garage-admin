package db

import (
	"path/filepath"
	"testing"
)

func newTestDB(t *testing.T) *DB {
	t.Helper()
	d, err := Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	return d
}

func TestCreateAndGetUser(t *testing.T) {
	d := newTestDB(t)
	u, err := d.CreateUser("alice", "hash123", "admin")
	if err != nil {
		t.Fatal(err)
	}
	if u.ID == 0 {
		t.Error("expected non-zero ID")
	}
	got, err := d.GetUserByUsername("alice")
	if err != nil {
		t.Fatal(err)
	}
	if got.Username != "alice" || got.Role != "admin" || got.PasswordHash != "hash123" {
		t.Errorf("unexpected user: %+v", got)
	}
}

func TestCreateUserDuplicate(t *testing.T) {
	d := newTestDB(t)
	if _, err := d.CreateUser("bob", "h", "admin"); err != nil {
		t.Fatal(err)
	}
	if _, err := d.CreateUser("bob", "h", "admin"); err == nil {
		t.Error("expected duplicate username error")
	}
}

func TestListAndCountUsers(t *testing.T) {
	d := newTestDB(t)
	d.CreateUser("a", "h", "admin")
	d.CreateUser("b", "h", "readonly")
	n, err := d.CountUsers()
	if err != nil || n != 2 {
		t.Fatalf("CountUsers = %d, %v; want 2", n, err)
	}
	list, err := d.ListUsers()
	if err != nil || len(list) != 2 {
		t.Fatalf("ListUsers len = %d, %v; want 2", len(list), err)
	}
}

func TestDeleteUser(t *testing.T) {
	d := newTestDB(t)
	u, _ := d.CreateUser("c", "h", "admin")
	if err := d.DeleteUser(u.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := d.GetUserByUsername("c"); err == nil {
		t.Error("expected user to be gone")
	}
}
