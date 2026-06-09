package api

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/HungHD/garage-admin/internal/db"
)

type clusterInput struct {
	Name          string `json:"name"`
	AdminEndpoint string `json:"admin_endpoint"`
	AdminToken    string `json:"admin_token"`
	S3Endpoint    string `json:"s3_endpoint"`
	S3Region      string `json:"s3_region"`
	S3AccessKey   string `json:"s3_access_key"`
	S3SecretKey   string `json:"s3_secret_key"`
	IsDefault     bool   `json:"is_default"`
}

func validClusterInput(in *clusterInput) bool {
	return strings.TrimSpace(in.Name) != "" && strings.TrimSpace(in.AdminEndpoint) != ""
}

// clusterView is the safe representation returned to clients (no secrets).
func clusterView(c *db.Cluster) map[string]any {
	return map[string]any{
		"id": c.ID, "name": c.Name, "admin_endpoint": c.AdminEndpoint,
		"s3_endpoint": c.S3Endpoint, "s3_region": c.S3Region,
		"s3_access_key": c.S3AccessKey, "is_default": c.IsDefault,
		"admin_key_set": c.AdminTokenEnc != "", "s3_secret_set": c.S3SecretKeyEnc != "",
	}
}

func (s *Server) mountClusters(r chi.Router) {
	r.Route("/clusters", func(r chi.Router) {
		r.Use(s.Auth.RequireAuth)
		r.Get("/", s.handleListClusters)
		r.With(s.Auth.RequireAdmin).Post("/", s.handleCreateCluster)
		r.With(s.Auth.RequireAdmin).Put("/{id}", s.handleUpdateCluster)
		r.With(s.Auth.RequireAdmin).Delete("/{id}", s.handleDeleteCluster)
	})
}

func (s *Server) handleListClusters(w http.ResponseWriter, r *http.Request) {
	list, err := s.DB.ListClusters()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "list failed")
		return
	}
	out := make([]map[string]any, 0, len(list))
	for i := range list {
		out = append(out, clusterView(&list[i]))
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleCreateCluster(w http.ResponseWriter, r *http.Request) {
	var in clusterInput
	if err := decodeJSON(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if !validClusterInput(&in) {
		writeError(w, http.StatusBadRequest, "name and admin_endpoint are required")
		return
	}
	c, err := s.clusterFromInput(&in)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "encrypt failed")
		return
	}
	created, err := s.DB.CreateCluster(c)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "create failed")
		return
	}
	writeJSON(w, http.StatusCreated, clusterView(created))
}

func (s *Server) handleUpdateCluster(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad id")
		return
	}
	existing, err := s.DB.GetCluster(id)
	if err != nil {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	var in clusterInput
	if err := decodeJSON(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if !validClusterInput(&in) {
		writeError(w, http.StatusBadRequest, "name and admin_endpoint are required")
		return
	}
	c, err := s.clusterFromInputPreserving(&in, existing)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "encrypt failed")
		return
	}
	c.ID = id
	if err := s.DB.UpdateCluster(c); err != nil {
		writeError(w, http.StatusInternalServerError, "update failed")
		return
	}
	writeJSON(w, http.StatusOK, clusterView(c))
}

func (s *Server) handleDeleteCluster(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad id")
		return
	}
	if err := s.DB.DeleteCluster(id); err != nil {
		writeError(w, http.StatusInternalServerError, "delete failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) clusterFromInput(in *clusterInput) (*db.Cluster, error) {
	tokenEnc, err := s.Cipher.Encrypt(in.AdminToken)
	if err != nil {
		return nil, err
	}
	var secEnc string
	if in.S3SecretKey != "" {
		secEnc, err = s.Cipher.Encrypt(in.S3SecretKey)
		if err != nil {
			return nil, err
		}
	}
	region := in.S3Region
	if region == "" {
		region = "garage"
	}
	return &db.Cluster{
		Name: in.Name, AdminEndpoint: in.AdminEndpoint, AdminTokenEnc: tokenEnc,
		S3Endpoint: in.S3Endpoint, S3Region: region, S3AccessKey: in.S3AccessKey,
		S3SecretKeyEnc: secEnc, IsDefault: in.IsDefault,
	}, nil
}

func (s *Server) clusterFromInputPreserving(in *clusterInput, existing *db.Cluster) (*db.Cluster, error) {
	c, err := s.clusterFromInput(in)
	if err != nil {
		return nil, err
	}
	if in.AdminToken == "" {
		c.AdminTokenEnc = existing.AdminTokenEnc
	}
	if in.S3SecretKey == "" {
		c.S3SecretKeyEnc = existing.S3SecretKeyEnc
	}
	return c, nil
}
