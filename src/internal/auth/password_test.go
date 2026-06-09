package auth

import "testing"

func TestHashAndVerify(t *testing.T) {
	hash, err := HashPassword("hunter2")
	if err != nil {
		t.Fatal(err)
	}
	if hash == "hunter2" {
		t.Fatal("hash equals plaintext")
	}
	if !VerifyPassword(hash, "hunter2") {
		t.Error("correct password should verify")
	}
	if VerifyPassword(hash, "wrong") {
		t.Error("wrong password should not verify")
	}
}
