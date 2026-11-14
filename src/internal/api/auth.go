package api

import (
	"errors"
	"log"
	"net"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/HungHD/garage-admin/internal/auth"
	"github.com/HungHD/garage-admin/internal/db"
)

func (s *Server) mountAuth(r chi.Router) {
	r.Post("/auth/login", s.handleLogin)
	r.Post("/auth/logout", s.handleLogout)
	r.With(s.Auth.RequireAuth).Get("/auth/me", s.handleMe)
	r.With(s.Auth.RequireAuth).Post("/auth/password", s.handleChangePassword)
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	ip := s.clientIP(r)
	lim := s.limiter()
	if ok, wait := lim.Allow(ip, body.Username); !ok {
		secs := int(wait.Seconds()) + 1
		w.Header().Set("Retry-After", strconv.Itoa(secs))
		writeError(w, http.StatusTooManyRequests, "quá nhiều lần đăng nhập sai, thử lại sau")
		return
	}
	user, err := s.Auth.Login(w, body.Username, body.Password)
	if errors.Is(err, auth.ErrInvalidCredentials) {
		writeError(w, http.StatusUnauthorized, "invalid credentials")
		return
	}
	if err != nil {
		lim.Release(ip, body.Username)
		writeError(w, http.StatusInternalServerError, "login failed")
		return
	}
	lim.Success(ip, body.Username)
	writeJSON(w, http.StatusOK, userView(user))
}

func (s *Server) limiter() *auth.LoginLimiter {
	s.limiterOnce.Do(func() {
		if s.LoginLimiter == nil {
			s.LoginLimiter = auth.NewLoginLimiter(nil)
		}
	})
	return s.LoginLimiter
}

// clientIP returns the peer address host. With TrustProxy it uses the
// right-most X-Forwarded-For entry (the one the trusted proxy appended);
// earlier entries are client-controlled. The header is ignored otherwise.
func (s *Server) clientIP(r *http.Request) string {
	if s.TrustProxy {
		parts := strings.Split(r.Header.Get("X-Forwarded-For"), ",")
		if last := strings.TrimSpace(parts[len(parts)-1]); last != "" {
			return last
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	s.Auth.Logout(w, r)
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromContext(r.Context())
	writeJSON(w, http.StatusOK, userView(u))
}

func userView(u *db.User) map[string]any {
	return map[string]any{"id": u.ID, "username": u.Username, "role": u.Role}
}

func (s *Server) handleChangePassword(w http.ResponseWriter, r *http.Request) {
	var body struct {
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
	}
	if err := decodeJSON(w, r, &body); err != nil || body.NewPassword == "" {
		writeError(w, http.StatusBadRequest, "new_password is required")
		return
	}
	u := auth.UserFromContext(r.Context())
	if u == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	if !auth.VerifyPassword(u.PasswordHash, body.CurrentPassword) {
		writeError(w, http.StatusBadRequest, "mật khẩu hiện tại không đúng")
		return
	}
	if err := auth.ValidatePassword(body.NewPassword); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	hash, err := auth.HashPassword(body.NewPassword)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "hash failed")
		return
	}
	if err := s.DB.UpdateUserPassword(u.ID, hash); err != nil {
		writeError(w, http.StatusInternalServerError, "update failed")
		return
	}
	// Revoke every other session so a stolen cookie dies with the old password.
	if err := s.Auth.DeleteOtherSessions(r, u.ID); err != nil {
		log.Printf("revoke sessions for user %d: %v", u.ID, err)
		writeError(w, http.StatusInternalServerError, "failed to revoke other sessions")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
