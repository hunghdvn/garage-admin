package config

import (
	"strings"
	"testing"
)

func TestLoadDefaults(t *testing.T) {
	t.Setenv("APP_SECRET_KEY", "0123456789abcdef0123456789abcdef")
	t.Setenv("APP_PORT", "")
	t.Setenv("APP_DB_PATH", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Port != "8080" {
		t.Errorf("Port = %q, want 8080", cfg.Port)
	}
	if cfg.DBPath != "/data/app.db" {
		t.Errorf("DBPath = %q, want /data/app.db", cfg.DBPath)
	}
	if len(cfg.SecretKey) != 32 {
		t.Errorf("SecretKey len = %d, want 32", len(cfg.SecretKey))
	}
}

func TestLoadRequiresSecret(t *testing.T) {
	t.Setenv("APP_SECRET_KEY", "")
	if _, err := Load(); err == nil {
		t.Fatal("expected error when APP_SECRET_KEY missing")
	}
}

func TestLoadSecretMustBe32Bytes(t *testing.T) {
	t.Setenv("APP_SECRET_KEY", "tooshort")
	if _, err := Load(); err == nil {
		t.Fatal("expected error when APP_SECRET_KEY is not 32 bytes")
	}
}

func TestLoadCookieSecure(t *testing.T) {
	t.Setenv("APP_SECRET_KEY", "0123456789abcdef0123456789abcdef")
	t.Setenv("APP_COOKIE_SECURE", "true")
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.CookieSecure {
		t.Error("expected CookieSecure=true")
	}
}

func TestLoadHexSecretKey(t *testing.T) {
	hexKey := "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"
	t.Setenv("APP_SECRET_KEY", hexKey)
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if len(cfg.SecretKey) != 32 || cfg.SecretKey[0] != 0x00 || cfg.SecretKey[1] != 0x11 {
		t.Errorf("hex key not decoded: %x", cfg.SecretKey)
	}
}

func TestLoadRawKeyStillAccepted(t *testing.T) {
	t.Setenv("APP_SECRET_KEY", "0123456789abcdef0123456789abcdef")
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if string(cfg.SecretKey) != "0123456789abcdef0123456789abcdef" {
		t.Error("32-byte key must be used raw")
	}
}

func TestLoadRejectsBadSecretKeys(t *testing.T) {
	for _, k := range []string{strings.Repeat("z", 64), strings.Repeat("a", 63), strings.Repeat("a", 33)} {
		t.Setenv("APP_SECRET_KEY", k)
		if _, err := Load(); err == nil {
			t.Errorf("expected error for key len %d", len(k))
		}
	}
}

func TestLoadTrustProxyAndOrigins(t *testing.T) {
	t.Setenv("APP_SECRET_KEY", "0123456789abcdef0123456789abcdef")
	t.Setenv("APP_TRUST_PROXY", "true")
	t.Setenv("APP_TRUSTED_ORIGINS", "https://admin.example.com, http://localhost:8080")
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.TrustProxy || len(cfg.TrustedOrigins) != 2 || cfg.TrustedOrigins[1] != "http://localhost:8080" {
		t.Errorf("cfg = %+v", cfg)
	}
}

func TestLoadRejectsInvalidOrigin(t *testing.T) {
	t.Setenv("APP_SECRET_KEY", "0123456789abcdef0123456789abcdef")
	for _, o := range []string{"admin.example.com", "https://a.example.com/path", "ftp://x"} {
		t.Setenv("APP_TRUSTED_ORIGINS", o)
		if _, err := Load(); err == nil {
			t.Errorf("expected error for origin %q", o)
		}
	}
}

func TestTrustProxyDefaultsOff(t *testing.T) {
	t.Setenv("APP_SECRET_KEY", "0123456789abcdef0123456789abcdef")
	t.Setenv("APP_TRUST_PROXY", "")
	cfg, _ := Load()
	if cfg.TrustProxy {
		t.Error("TrustProxy must default to false")
	}
}
