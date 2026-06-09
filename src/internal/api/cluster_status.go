package api

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/HungHD/garage-admin/internal/db"
	"github.com/HungHD/garage-admin/internal/garage"
)

func (s *Server) mountCluster(r chi.Router) {
	r.Route("/cluster", func(r chi.Router) {
		r.Use(s.Auth.RequireAuth)
		r.Get("/health", s.handleClusterHealth)
		r.Get("/status", s.handleClusterStatus)
	})
}

// garageClientForRequest builds a Garage client for the selected cluster.
// Cluster is chosen by ?cluster=<id>, falling back to the default cluster.
func (s *Server) garageClientForRequest(r *http.Request) (*garage.Client, error) {
	var c *db.Cluster
	var err error
	if idStr := r.URL.Query().Get("cluster"); idStr != "" {
		id, perr := strconv.ParseInt(idStr, 10, 64)
		if perr != nil {
			return nil, perr
		}
		c, err = s.DB.GetCluster(id)
	} else {
		c, err = s.DB.GetDefaultCluster()
	}
	if err != nil {
		return nil, err
	}
	token, err := s.Cipher.Decrypt(c.AdminTokenEnc)
	if err != nil {
		return nil, err
	}
	return garage.New(c.AdminEndpoint, token), nil
}

func (s *Server) handleClusterHealth(w http.ResponseWriter, r *http.Request) {
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	h, err := client.GetClusterHealth()
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, h)
}

func (s *Server) handleClusterStatus(w http.ResponseWriter, r *http.Request) {
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	st, err := client.GetClusterStatus()
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, st)
}
