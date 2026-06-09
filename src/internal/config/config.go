// Package config loads runtime configuration from environment variables.
package config

import (
	"errors"
	"os"
)

// Config holds runtime configuration.
type Config struct {
	Port      string
	DBPath    string
	SecretKey []byte // 32 bytes, used for AES-256-GCM
	AdminUser string // optional bootstrap admin username
	AdminPass string // optional bootstrap admin password
}

// Load reads configuration from the environment.
// APP_SECRET_KEY is required and must be exactly 32 bytes.
func Load() (*Config, error) {
	secret := os.Getenv("APP_SECRET_KEY")
	if secret == "" {
		return nil, errors.New("APP_SECRET_KEY is required")
	}
	if len(secret) != 32 {
		return nil, errors.New("APP_SECRET_KEY must be exactly 32 bytes")
	}

	cfg := &Config{
		Port:      getenv("APP_PORT", "8080"),
		DBPath:    getenv("APP_DB_PATH", "/data/app.db"),
		SecretKey: []byte(secret),
		AdminUser: os.Getenv("ADMIN_USER"),
		AdminPass: os.Getenv("ADMIN_PASSWORD"),
	}
	return cfg, nil
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
