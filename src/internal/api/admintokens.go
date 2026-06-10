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

// adminTokenReqFromBody parses a create/update request body. NOTE: NeverExpires
// is derived as (expiration == nil), which is correct for CreateAdminToken but
// NOT for UpdateAdminToken — on update, omitting expiration would clear an
// existing one. The update endpoint currently has no UI. Before wiring an edit
// UI, change this so update only sends neverExpires/expiration when the client
// explicitly provides them (e.g. add an explicit neverExpires field to the body).
func (s *Server) adminTokenReqFromBody(r *http.Request) (garage.AdminTokenRequest, error) {
	var body struct {
		Name       string   `json:"name"`
		Scope      []string `json:"scope"`
		Expiration *string  `json:"expiration"`
	}
	if err := decodeJSON(r, &body); err != nil {
		return garage.AdminTokenRequest{}, err
	}
	scope := body.Scope
	if scope == nil {
		scope = []string{}
	}
	return garage.AdminTokenRequest{
		Name:         body.Name,
		Scope:        scope,
		Expiration:   body.Expiration,
		NeverExpires: body.Expiration == nil,
	}, nil
}

func (s *Server) handleCreateAdminToken(w http.ResponseWriter, r *http.Request) {
	req, err := s.adminTokenReqFromBody(r)
	if err != nil || req.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
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
	req, err := s.adminTokenReqFromBody(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
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
