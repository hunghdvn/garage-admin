package api

import (
	"errors"
	"net/http"

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
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	user, err := s.Auth.Login(w, body.Username, body.Password)
	if errors.Is(err, auth.ErrInvalidCredentials) {
		writeError(w, http.StatusUnauthorized, "invalid credentials")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "login failed")
		return
	}
	writeJSON(w, http.StatusOK, userView(user))
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
	if err := decodeJSON(r, &body); err != nil || body.NewPassword == "" {
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
	hash, err := auth.HashPassword(body.NewPassword)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "hash failed")
		return
	}
	if err := s.DB.UpdateUserPassword(u.ID, hash); err != nil {
		writeError(w, http.StatusInternalServerError, "update failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
