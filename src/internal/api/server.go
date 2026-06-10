// Package api wires HTTP routes for the admin website.
package api

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/HungHD/garage-admin/internal/auth"
	"github.com/HungHD/garage-admin/internal/crypto"
	"github.com/HungHD/garage-admin/internal/db"
	"github.com/HungHD/garage-admin/internal/garage"
	"github.com/HungHD/garage-admin/internal/s3"
)

// Server holds dependencies shared by handlers.
type Server struct {
	DB     *db.DB
	Auth   *auth.Service
	Cipher *crypto.Cipher
	Static http.Handler // SPA fallback handler
	// NewS3 builds an S3 client from cluster credentials. Injectable for tests.
	NewS3 func(endpoint, region, accessKey, secretKey string) (s3.Client, error)
}

// Routes builds the chi router.
func (s *Server) Routes() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.Recoverer)

	r.Route("/api", func(r chi.Router) {
		r.Get("/health", func(w http.ResponseWriter, _ *http.Request) {
			writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
		})
		s.mountAuth(r)
		s.mountClusters(r)
		s.mountCluster(r)
		s.mountBuckets(r)
		s.mountKeys(r)
		s.mountAdminTokens(r)
		s.mountNodes(r)
		s.mountFiles(r)
		s.mountUsers(r)
	})

	if s.Static != nil {
		r.NotFound(s.Static.ServeHTTP)
	}
	return r
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// writeGarageError maps a Garage client error to an HTTP response. Garage client
// errors (4xx) are surfaced with their real status and message; anything else
// (network failure, upstream 5xx) becomes 502 Bad Gateway.
func writeGarageError(w http.ResponseWriter, err error) {
	var ae *garage.APIError
	if errors.As(err, &ae) {
		if ae.StatusCode >= 400 && ae.StatusCode < 500 {
			msg := ae.Message
			if msg == "" {
				msg = ae.Raw
			}
			writeError(w, ae.StatusCode, msg)
			return
		}
		// upstream 5xx → surface message but as 502
		if ae.Message != "" {
			writeError(w, http.StatusBadGateway, ae.Message)
			return
		}
	}
	writeError(w, http.StatusBadGateway, err.Error())
}

func decodeJSON(r *http.Request, v any) error {
	return json.NewDecoder(r.Body).Decode(v)
}
