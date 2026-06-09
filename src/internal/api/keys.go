package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/HungHD/garage-admin/internal/auth"
	"github.com/HungHD/garage-admin/internal/garage"
)

func (s *Server) mountKeys(r chi.Router) {
	r.Route("/keys", func(r chi.Router) {
		r.Use(s.Auth.RequireAuth)
		r.Get("/", s.handleListKeys)
		r.Get("/{id}", s.handleGetKey)
		r.With(s.Auth.RequireAdmin).Post("/", s.handleCreateKey)
		r.With(s.Auth.RequireAdmin).Post("/import", s.handleImportKey)
		r.With(s.Auth.RequireAdmin).Post("/{id}", s.handleUpdateKey)
		r.With(s.Auth.RequireAdmin).Delete("/{id}", s.handleDeleteKey)
	})
}

func (s *Server) handleListKeys(w http.ResponseWriter, r *http.Request) {
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	list, err := client.ListKeys()
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (s *Server) handleGetKey(w http.ResponseWriter, r *http.Request) {
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	// Revealing the secret requires admin role.
	reveal := r.URL.Query().Get("reveal") == "1"
	if reveal {
		u := auth.UserFromContext(r.Context())
		if u == nil || u.Role != "admin" {
			writeError(w, http.StatusForbidden, "forbidden")
			return
		}
	}
	info, err := client.GetKeyInfo(chi.URLParam(r, "id"), reveal)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, info)
}

func (s *Server) handleCreateKey(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name string `json:"name"`
	}
	if err := decodeJSON(r, &body); err != nil || body.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	info, err := client.CreateKey(body.Name)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, info)
}

func (s *Server) handleImportKey(w http.ResponseWriter, r *http.Request) {
	var body struct {
		AccessKeyID     string `json:"access_key_id"`
		SecretAccessKey string `json:"secret_access_key"`
		Name            string `json:"name"`
	}
	if err := decodeJSON(r, &body); err != nil || body.AccessKeyID == "" || body.SecretAccessKey == "" {
		writeError(w, http.StatusBadRequest, "access_key_id and secret_access_key are required")
		return
	}
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	info, err := client.ImportKey(body.AccessKeyID, body.SecretAccessKey, body.Name)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, info)
}

func (s *Server) handleUpdateKey(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name         *string `json:"name"`
		CreateBucket *bool   `json:"create_bucket"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	var req garage.UpdateKeyRequest
	req.Name = body.Name
	if body.CreateBucket != nil {
		if *body.CreateBucket {
			req.Allow = &garage.KeyPermissions{CreateBucket: true}
		} else {
			req.Deny = &garage.KeyPermissions{CreateBucket: true}
		}
	}
	info, err := client.UpdateKey(chi.URLParam(r, "id"), req)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, info)
}

func (s *Server) handleDeleteKey(w http.ResponseWriter, r *http.Request) {
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	if err := client.DeleteKey(chi.URLParam(r, "id")); err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
