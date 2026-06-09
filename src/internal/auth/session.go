package auth

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/http"
	"time"

	"github.com/HungHD/garage-admin/internal/db"
)

const (
	cookieName = "ga_session"
	sessionTTL = 24 * time.Hour
)

// ErrInvalidCredentials is returned when login fails.
var ErrInvalidCredentials = errors.New("invalid credentials")

type ctxKey int

const userKey ctxKey = 0

// Service handles login, logout, and request authentication.
type Service struct {
	db     *db.DB
	secure bool // set Secure flag on cookies (true when serving HTTPS)
}

// NewService creates a session service.
func NewService(d *db.DB) *Service { return &Service{db: d} }

// SetSecure toggles the Secure cookie flag.
func (s *Service) SetSecure(v bool) { s.secure = v }

// Login verifies credentials, creates a session, and sets the cookie.
func (s *Service) Login(w http.ResponseWriter, username, password string) (*db.User, error) {
	u, err := s.db.GetUserByUsername(username)
	if errors.Is(err, db.ErrNotFound) {
		return nil, ErrInvalidCredentials
	}
	if err != nil {
		return nil, err
	}
	if !VerifyPassword(u.PasswordHash, password) {
		return nil, ErrInvalidCredentials
	}
	token, err := randomToken()
	if err != nil {
		return nil, err
	}
	exp := time.Now().Add(sessionTTL).UTC()
	if err := s.db.CreateSession(token, u.ID, exp.Format(time.RFC3339)); err != nil {
		return nil, err
	}
	http.SetCookie(w, &http.Cookie{
		Name:     cookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   s.secure,
		SameSite: http.SameSiteLaxMode,
		Expires:  exp,
	})
	return u, nil
}

// Logout deletes the current session and clears the cookie.
func (s *Service) Logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(cookieName); err == nil {
		s.db.DeleteSession(c.Value)
	}
	http.SetCookie(w, &http.Cookie{
		Name: cookieName, Value: "", Path: "/", HttpOnly: true,
		Secure: s.secure, SameSite: http.SameSiteLaxMode, MaxAge: -1,
	})
}

// RequireAuth is middleware that loads the user from the session cookie.
func (s *Service) RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(cookieName)
		if err != nil {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		sess, err := s.db.GetSession(c.Value)
		if err != nil {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if exp, perr := time.Parse(time.RFC3339, sess.ExpiresAt); perr == nil && time.Now().After(exp) {
			s.db.DeleteSession(c.Value)
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		u, err := s.db.GetUserByID(sess.UserID)
		if err != nil {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		ctx := context.WithValue(r.Context(), userKey, u)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// RequireAdmin is middleware (use after RequireAuth) that rejects non-admins.
func (s *Service) RequireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u := UserFromContext(r.Context())
		if u == nil || u.Role != "admin" {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// UserFromContext returns the authenticated user, or nil.
func UserFromContext(ctx context.Context) *db.User {
	u, _ := ctx.Value(userKey).(*db.User)
	return u
}

func randomToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
