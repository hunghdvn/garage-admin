package crypto

import "testing"

var key = []byte("0123456789abcdef0123456789abcdef") // 32 bytes

func TestRoundTrip(t *testing.T) {
	c, err := New(key)
	if err != nil {
		t.Fatal(err)
	}
	plain := "super-secret-admin-token"
	enc, err := c.Encrypt(plain)
	if err != nil {
		t.Fatal(err)
	}
	if enc == plain {
		t.Fatal("ciphertext equals plaintext")
	}
	dec, err := c.Decrypt(enc)
	if err != nil {
		t.Fatal(err)
	}
	if dec != plain {
		t.Errorf("Decrypt = %q, want %q", dec, plain)
	}
}

func TestEncryptIsNondeterministic(t *testing.T) {
	c, _ := New(key)
	a, _ := c.Encrypt("x")
	b, _ := c.Encrypt("x")
	if a == b {
		t.Error("expected different ciphertexts due to random nonce")
	}
}

func TestDecryptRejectsTampered(t *testing.T) {
	c, _ := New(key)
	if _, err := c.Decrypt("not-valid-base64-!!!"); err == nil {
		t.Error("expected error decrypting garbage")
	}
}

func TestNewRejectsWrongKeyLength(t *testing.T) {
	if _, err := New([]byte("short")); err == nil {
		t.Error("expected error for non-32-byte key")
	}
}
