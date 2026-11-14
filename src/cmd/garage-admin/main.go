// Command garage-admin runs the Garage admin website server.
package main

import (
	"context"
	"log"
	"net/http"
	"time"

	"github.com/HungHD/garage-admin/internal/api"
	"github.com/HungHD/garage-admin/internal/auth"
	"github.com/HungHD/garage-admin/internal/config"
	"github.com/HungHD/garage-admin/internal/crypto"
	"github.com/HungHD/garage-admin/internal/db"
	"github.com/HungHD/garage-admin/internal/s3"
	"github.com/HungHD/garage-admin/internal/usage"
	"github.com/HungHD/garage-admin/internal/web"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	database, err := db.Open(cfg.DBPath)
	if err != nil {
		log.Fatalf("db: %v", err)
	}
	defer database.Close()

	if err := bootstrapAdmin(database, cfg); err != nil {
		log.Fatalf("bootstrap: %v", err)
	}

	if err := database.DeleteExpiredSessions(); err != nil {
		log.Printf("warning: failed to sweep expired sessions: %v", err)
	}

	cipher, err := crypto.New(cfg.SecretKey)
	if err != nil {
		log.Fatalf("crypto: %v", err)
	}

	// Expired sessions are otherwise only swept at startup.
	go sweepSessions(context.Background(), database, time.Hour)

	// Hourly usage snapshots for the history charts.
	go (&usage.Collector{DB: database, Cipher: cipher}).Run(context.Background())

	authSvc := auth.NewService(database)
	authSvc.SetSecure(cfg.CookieSecure)

	srv := &api.Server{
		DB:     database,
		Auth:   authSvc,
		Cipher: cipher,
		Static: web.Handler(),
		NewS3:  s3.New,

		TrustedOrigins: cfg.TrustedOrigins,
		TrustProxy:     cfg.TrustProxy,
	}

	log.Printf("garage-admin listening on :%s", cfg.Port)
	// No Read/WriteTimeout: uploads and downloads are long streams.
	httpSrv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           srv.Routes(),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	if err := httpSrv.ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}

// sweepSessions deletes expired sessions every interval until ctx is done.
func sweepSessions(ctx context.Context, d *db.DB, interval time.Duration) {
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if err := d.DeleteExpiredSessions(); err != nil {
				log.Printf("warning: failed to sweep expired sessions: %v", err)
			}
		}
	}
}

// bootstrapAdmin creates an initial admin user from env if no users exist.
func bootstrapAdmin(d *db.DB, cfg *config.Config) error {
	n, err := d.CountUsers()
	if err != nil {
		return err
	}
	if n > 0 || cfg.AdminUser == "" || cfg.AdminPass == "" {
		return nil
	}
	if err := auth.ValidatePassword(cfg.AdminPass); err != nil {
		// Do not fail: existing deployments may already use a weak password.
		log.Printf("warning: ADMIN_PASSWORD does not meet the password policy (%v); change it after first login", err)
	}
	hash, err := auth.HashPassword(cfg.AdminPass)
	if err != nil {
		return err
	}
	_, err = d.CreateUser(cfg.AdminUser, hash, "admin")
	if err == nil {
		log.Printf("bootstrapped admin user %q", cfg.AdminUser)
	}
	return err
}
