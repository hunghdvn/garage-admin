package config

import "testing"

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
