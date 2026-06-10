package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/HungHD/garage-admin/internal/garage"
)

func (s *Server) mountAdminTokens(r chi.Router) {
	r.Route("/admin-tokens", func(r chi.Router) {
		r.Use(s.Auth.RequireAuth)
		r.Get("/", s.handleListAdminTokens)
		r.Get("/current", s.handleCurrentAdminToken)
		r.With(s.Auth.RequireAdmin).Post("/", s.handleCreateAdminToken)
		r.With(s.Auth.RequireAdmin).Post("/{id}", s.handleUpdateAdminToken)
		r.With(s.Auth.RequireAdmin).Delete("/{id}", s.handleDeleteAdminToken)
	})
}

func (s *Server) handleListAdminTokens(w http.ResponseWriter, r *http.Request) {
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	list, err := client.ListAdminTokens()
	if err != nil {
		writeGarageError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (s *Server) handleCurrentAdminToken(w http.ResponseWriter, r *http.Request) {
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	info, err := client.GetCurrentAdminTokenInfo()
	if err != nil {
		writeGarageError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, info)
}

func (s *Server) handleCreateAdminToken(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name       string   `json:"name"`
		Scope      []string `json:"scope"`
		Expiration *string  `json:"expiration"`
	}
	if err := decodeJSON(r, &body); err != nil || body.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	scope := body.Scope
	if scope == nil {
		scope = []string{}
	}
	req := garage.AdminTokenRequest{Name: body.Name, Scope: scope, Expiration: body.Expiration}
	if body.Expiration == nil {
		t := true
		req.NeverExpires = &t
	}
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	info, err := client.CreateAdminToken(req)
	if err != nil {
		writeGarageError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, info)
}

func (s *Server) handleUpdateAdminToken(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name         string   `json:"name"`
		Scope        []string `json:"scope"`
		Expiration   *string  `json:"expiration"`
		NeverExpires *bool    `json:"never_expires"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	scope := body.Scope
	if scope == nil {
		scope = []string{}
	}
	req := garage.AdminTokenRequest{Name: body.Name, Scope: scope, Expiration: body.Expiration, NeverExpires: body.NeverExpires}
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	info, err := client.UpdateAdminToken(chi.URLParam(r, "id"), req)
	if err != nil {
		writeGarageError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, info)
}

func (s *Server) handleDeleteAdminToken(w http.ResponseWriter, r *http.Request) {
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	if err := client.DeleteAdminToken(chi.URLParam(r, "id")); err != nil {
		writeGarageError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
