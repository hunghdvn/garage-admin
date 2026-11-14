package auth

import (
	"strings"
	"testing"
)

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

func TestValidatePassword(t *testing.T) {
	for p, ok := range map[string]bool{
		"":                      false,
		"1234567":               false,
		"12345678":              true,
		strings.Repeat("a", 72): true,
		strings.Repeat("a", 73): false,
		strings.Repeat("é", 37): false, // 74 bytes
	} {
		if err := ValidatePassword(p); (err == nil) != ok {
			t.Errorf("ValidatePassword(len %d) err=%v, want ok=%v", len(p), err, ok)
		}
	}
}
