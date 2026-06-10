// Command garage-admin runs the Garage admin website server.
package main

import (
	"log"
	"net/http"

	"github.com/HungHD/garage-admin/internal/api"
	"github.com/HungHD/garage-admin/internal/auth"
	"github.com/HungHD/garage-admin/internal/config"
	"github.com/HungHD/garage-admin/internal/crypto"
	"github.com/HungHD/garage-admin/internal/db"
	"github.com/HungHD/garage-admin/internal/s3"
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

	authSvc := auth.NewService(database)
	authSvc.SetSecure(cfg.CookieSecure)

	srv := &api.Server{
		DB:     database,
		Auth:   authSvc,
		Cipher: cipher,
		Static: web.Handler(),
		NewS3:  s3.New,
	}

	log.Printf("garage-admin listening on :%s", cfg.Port)
	if err := http.ListenAndServe(":"+cfg.Port, srv.Routes()); err != nil {
		log.Fatal(err)
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
