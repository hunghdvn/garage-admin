// Package api wires HTTP routes for the admin website.
package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"mime"
	"net/http"
	"sync"

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
	// TrustedOrigins are extra origins allowed for cross-origin unsafe requests.
	TrustedOrigins []string
	// TrustProxy makes clientIP use the right-most X-Forwarded-For entry.
	TrustProxy bool
	// LoginLimiter throttles failed logins; created on first use if nil.
	LoginLimiter *auth.LoginLimiter

	limiterOnce sync.Once
}

// maxJSONBody caps request bodies read by decodeJSON.
const maxJSONBody = 1 << 20

// contentSecurityPolicy: the SPA only loads external module scripts; Mantine
// needs inline styles.
const contentSecurityPolicy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Content-Security-Policy", contentSecurityPolicy)
		next.ServeHTTP(w, r)
	})
}

// csrfProtection builds the cross-origin guard for the API router.
func (s *Server) csrfProtection() (*http.CrossOriginProtection, error) {
	cop := http.NewCrossOriginProtection()
	for _, o := range s.TrustedOrigins {
		if err := cop.AddTrustedOrigin(o); err != nil {
			return nil, fmt.Errorf("trusted origin %q: %w", o, err)
		}
	}
	return cop, nil
}

// Routes builds the chi router.
func (s *Server) Routes() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.Recoverer)
	r.Use(securityHeaders)

	cop, err := s.csrfProtection()
	if err != nil {
		// Origins are validated at config load; this is a programming error.
		panic(err)
	}
	r.Route("/api", func(r chi.Router) {
		r.Use(cop.Handler)
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
		s.mountUsage(r)
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

// decodeJSON decodes a JSON body of at most 1 MiB. It requires an
// application/json Content-Type so a cross-site form (text/plain) cannot
// smuggle a JSON body.
func decodeJSON(w http.ResponseWriter, r *http.Request, v any) error {
	mt, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mt != "application/json" {
		return errors.New("content-type must be application/json")
	}
	return json.NewDecoder(http.MaxBytesReader(w, r.Body, maxJSONBody)).Decode(v)
}
