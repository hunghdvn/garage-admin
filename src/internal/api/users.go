package api

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/HungHD/garage-admin/internal/auth"
	"github.com/HungHD/garage-admin/internal/db"
)

func (s *Server) mountUsers(r chi.Router) {
	r.Route("/users", func(r chi.Router) {
		r.Use(s.Auth.RequireAuth)
		r.Use(s.Auth.RequireAdmin)
		r.Get("/", s.handleListUsers)
		r.Post("/", s.handleCreateUser)
		r.Post("/{id}", s.handleUpdateUser)
		r.Delete("/{id}", s.handleDeleteUser)
	})
}

func userListView(u *db.User) map[string]any {
	return map[string]any{"id": u.ID, "username": u.Username, "role": u.Role, "created_at": u.CreatedAt}
}

func (s *Server) handleListUsers(w http.ResponseWriter, r *http.Request) {
	users, err := s.DB.ListUsers()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "list failed")
		return
	}
	out := make([]map[string]any, 0, len(users))
	for i := range users {
		out = append(out, userListView(&users[i]))
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleCreateUser(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Role     string `json:"role"`
	}
	if err := decodeJSON(r, &body); err != nil || body.Username == "" || body.Password == "" {
		writeError(w, http.StatusBadRequest, "username and password are required")
		return
	}
	if body.Role != "admin" && body.Role != "readonly" {
		writeError(w, http.StatusBadRequest, "role must be admin or readonly")
		return
	}
	hash, err := auth.HashPassword(body.Password)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "hash failed")
		return
	}
	u, err := s.DB.CreateUser(body.Username, hash, body.Role)
	if err != nil {
		writeError(w, http.StatusBadRequest, "username already exists")
		return
	}
	writeJSON(w, http.StatusCreated, userListView(u))
}

func (s *Server) handleUpdateUser(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad id")
		return
	}
	target, err := s.DB.GetUserByID(id)
	if err != nil {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	var body struct {
		Role     *string `json:"role"`
		Password *string `json:"password"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if body.Role != nil {
		if *body.Role != "admin" && *body.Role != "readonly" {
			writeError(w, http.StatusBadRequest, "role must be admin or readonly")
			return
		}
		// Guard: don't demote the last admin.
		if target.Role == "admin" && *body.Role == "readonly" {
			n, _ := s.DB.CountAdmins()
			if n <= 1 {
				writeError(w, http.StatusBadRequest, "không thể hạ quyền admin cuối cùng")
				return
			}
		}
		if err := s.DB.UpdateUserRole(id, *body.Role); err != nil {
			writeError(w, http.StatusInternalServerError, "update failed")
			return
		}
	}
	if body.Password != nil && *body.Password != "" {
		hash, herr := auth.HashPassword(*body.Password)
		if herr != nil {
			writeError(w, http.StatusInternalServerError, "hash failed")
			return
		}
		if err := s.DB.UpdateUserPassword(id, hash); err != nil {
			writeError(w, http.StatusInternalServerError, "update failed")
			return
		}
	}
	updated, _ := s.DB.GetUserByID(id)
	writeJSON(w, http.StatusOK, userListView(updated))
}

func (s *Server) handleDeleteUser(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad id")
		return
	}
	me := auth.UserFromContext(r.Context())
	if me != nil && me.ID == id {
		writeError(w, http.StatusBadRequest, "không thể xóa chính mình")
		return
	}
	target, err := s.DB.GetUserByID(id)
	if err != nil {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if target.Role == "admin" {
		n, _ := s.DB.CountAdmins()
		if n <= 1 {
			writeError(w, http.StatusBadRequest, "không thể xóa admin cuối cùng")
			return
		}
	}
	if err := s.DB.DeleteUser(id); err != nil {
		writeError(w, http.StatusInternalServerError, "delete failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
