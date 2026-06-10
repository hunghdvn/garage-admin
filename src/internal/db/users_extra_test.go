package db

import "testing"

func TestUpdateUserRoleAndPassword(t *testing.T) {
	d := newTestDB(t)
	u, _ := d.CreateUser("alice", "h1", "readonly")

	if err := d.UpdateUserRole(u.ID, "admin"); err != nil {
		t.Fatal(err)
	}
	if err := d.UpdateUserPassword(u.ID, "h2"); err != nil {
		t.Fatal(err)
	}
	got, _ := d.GetUserByID(u.ID)
	if got.Role != "admin" || got.PasswordHash != "h2" {
		t.Errorf("got %+v", got)
	}
}

func TestCountAdmins(t *testing.T) {
	d := newTestDB(t)
	d.CreateUser("a", "h", "admin")
	d.CreateUser("b", "h", "readonly")
	d.CreateUser("c", "h", "admin")
	n, err := d.CountAdmins()
	if err != nil || n != 2 {
		t.Fatalf("CountAdmins = %d, %v; want 2", n, err)
	}
}
