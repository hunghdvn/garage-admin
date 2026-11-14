// Package config loads runtime configuration from environment variables.
package config

import (
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
)

// Config holds runtime configuration.
type Config struct {
	Port         string
	DBPath       string
	SecretKey    []byte // 32 bytes, used for AES-256-GCM
	AdminUser    string // optional bootstrap admin username
	AdminPass    string // optional bootstrap admin password
	CookieSecure bool   // set Secure flag on session cookies (true for HTTPS)
	// TrustProxy makes the login limiter use the right-most X-Forwarded-For
	// entry as the client IP. Only enable behind a proxy that appends it.
	TrustProxy bool
	// TrustedOrigins are extra origins allowed to make cross-origin unsafe
	// requests (for proxies that rewrite the Host header).
	TrustedOrigins []string
}

// Load reads configuration from the environment.
// APP_SECRET_KEY is required: exactly 32 bytes (legacy raw key) or 64 hex chars.
func Load() (*Config, error) {
	secret := os.Getenv("APP_SECRET_KEY")
	if secret == "" {
		return nil, errors.New("APP_SECRET_KEY is required")
	}
	key, err := parseSecretKey(secret)
	if err != nil {
		return nil, err
	}
	origins, err := parseOrigins(os.Getenv("APP_TRUSTED_ORIGINS"))
	if err != nil {
		return nil, err
	}

	cfg := &Config{
		Port:           getenv("APP_PORT", "8080"),
		DBPath:         getenv("APP_DB_PATH", "/data/app.db"),
		SecretKey:      key,
		AdminUser:      os.Getenv("ADMIN_USER"),
		AdminPass:      os.Getenv("ADMIN_PASSWORD"),
		CookieSecure:   parseBool(os.Getenv("APP_COOKIE_SECURE")),
		TrustProxy:     parseBool(os.Getenv("APP_TRUST_PROXY")),
		TrustedOrigins: origins,
	}
	return cfg, nil
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func parseBool(v string) bool {
	switch strings.ToLower(v) {
	case "1", "true", "yes":
		return true
	default:
		return false
	}
}

// parseSecretKey accepts a raw 32-byte key (kept for existing deployments) or
// a 64-character hex string decoded to 32 bytes.
func parseSecretKey(secret string) ([]byte, error) {
	if len(secret) == 32 {
		return []byte(secret), nil
	}
	if len(secret) == 64 {
		if b, err := hex.DecodeString(secret); err == nil {
			return b, nil
		}
	}
	return nil, errors.New("APP_SECRET_KEY must be exactly 32 bytes or 64 hex characters (e.g. `openssl rand -hex 32`)")
}

// parseOrigins parses a comma-separated list of origins like
// https://admin.example.com (scheme and host only).
func parseOrigins(v string) ([]string, error) {
	var out []string
	for _, o := range strings.Split(v, ",") {
		o = strings.TrimSpace(o)
		if o == "" {
			continue
		}
		u, err := url.Parse(o)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" ||
			u.Path != "" || u.RawQuery != "" || u.Fragment != "" || u.User != nil {
			return nil, fmt.Errorf("APP_TRUSTED_ORIGINS: invalid origin %q (expected e.g. https://admin.example.com)", o)
		}
		out = append(out, o)
	}
	return out, nil
}
