package api

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/HungHD/garage-admin/internal/garage"
)

func (s *Server) mountBuckets(r chi.Router) {
	r.Route("/buckets", func(r chi.Router) {
		r.Use(s.Auth.RequireAuth)
		r.Get("/", s.handleListBuckets)
		r.Get("/{id}", s.handleGetBucket)
		r.With(s.Auth.RequireAdmin).Post("/", s.handleCreateBucket)
		r.With(s.Auth.RequireAdmin).Post("/{id}", s.handleUpdateBucket)
		r.With(s.Auth.RequireAdmin).Delete("/{id}", s.handleDeleteBucket)
		r.Get("/{id}/inspect", s.handleInspectObject)
		r.With(s.Auth.RequireAdmin).Post("/{id}/cleanup-uploads", s.handleCleanupUploads)
		r.With(s.Auth.RequireAdmin).Post("/{id}/aliases", s.handleAddBucketAlias)
		r.With(s.Auth.RequireAdmin).Delete("/{id}/aliases/{alias}", s.handleRemoveBucketAlias)
		r.With(s.Auth.RequireAdmin).Post("/{id}/permissions", s.handleBucketPermission)
	})
}

func (s *Server) handleListBuckets(w http.ResponseWriter, r *http.Request) {
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	list, err := client.ListBuckets()
	if err != nil {
		writeGarageError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (s *Server) handleGetBucket(w http.ResponseWriter, r *http.Request) {
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	info, err := client.GetBucketInfo(chi.URLParam(r, "id"))
	if err != nil {
		writeGarageError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, info)
}

func (s *Server) handleCreateBucket(w http.ResponseWriter, r *http.Request) {
	var body struct {
		GlobalAlias string `json:"global_alias"`
	}
	if err := decodeJSON(r, &body); err != nil || body.GlobalAlias == "" {
		writeError(w, http.StatusBadRequest, "global_alias is required")
		return
	}
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	info, err := client.CreateBucket(body.GlobalAlias)
	if err != nil {
		writeGarageError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, info)
}

func (s *Server) handleUpdateBucket(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Website *struct {
			Enabled       bool   `json:"enabled"`
			IndexDocument string `json:"index_document"`
			ErrorDocument string `json:"error_document"`
		} `json:"website"`
		Quotas *struct {
			MaxSize    *int64 `json:"max_size"`
			MaxObjects *int64 `json:"max_objects"`
		} `json:"quotas"`
		CorsRules *json.RawMessage `json:"cors_rules"`
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
	var req garage.UpdateBucketRequest
	if body.Website != nil {
		req.WebsiteAccess = &garage.WebsiteAccessUpdate{
			Enabled:       body.Website.Enabled,
			IndexDocument: body.Website.IndexDocument,
			ErrorDocument: body.Website.ErrorDocument,
		}
	}
	if body.Quotas != nil {
		req.Quotas = &garage.Quotas{MaxSize: body.Quotas.MaxSize, MaxObjects: body.Quotas.MaxObjects}
	}
	if body.CorsRules != nil {
		req.CorsRules = body.CorsRules
	}
	info, err := client.UpdateBucket(chi.URLParam(r, "id"), req)
	if err != nil {
		writeGarageError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, info)
}

func (s *Server) handleDeleteBucket(w http.ResponseWriter, r *http.Request) {
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	if err := client.DeleteBucket(chi.URLParam(r, "id")); err != nil {
		writeGarageError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleAddBucketAlias(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Alias       string `json:"alias"`
		Local       bool   `json:"local"`
		AccessKeyID string `json:"access_key_id"`
	}
	if err := decodeJSON(r, &body); err != nil || body.Alias == "" {
		writeError(w, http.StatusBadRequest, "alias is required")
		return
	}
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	id := chi.URLParam(r, "id")
	if body.Local {
		if body.AccessKeyID == "" {
			writeError(w, http.StatusBadRequest, "access_key_id is required for a local alias")
			return
		}
		err = client.AddBucketAliasLocal(id, body.Alias, body.AccessKeyID)
	} else {
		err = client.AddBucketAlias(id, body.Alias)
	}
	if err != nil {
		writeGarageError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleRemoveBucketAlias(w http.ResponseWriter, r *http.Request) {
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	id := chi.URLParam(r, "id")
	alias := chi.URLParam(r, "alias")
	if akid := r.URL.Query().Get("access_key_id"); akid != "" {
		err = client.RemoveBucketAliasLocal(id, alias, akid)
	} else {
		err = client.RemoveBucketAlias(id, alias)
	}
	if err != nil {
		writeGarageError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleCleanupUploads(w http.ResponseWriter, r *http.Request) {
	var body struct {
		OlderThanSecs int64 `json:"older_than_secs"`
	}
	if err := decodeJSON(r, &body); err != nil || body.OlderThanSecs <= 0 {
		writeError(w, http.StatusBadRequest, "older_than_secs must be > 0")
		return
	}
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	raw, err := client.CleanupIncompleteUploads(chi.URLParam(r, "id"), body.OlderThanSecs)
	if err != nil {
		writeGarageError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(raw)
}

func (s *Server) handleInspectObject(w http.ResponseWriter, r *http.Request) {
	key := r.URL.Query().Get("key")
	if key == "" {
		writeError(w, http.StatusBadRequest, "key is required")
		return
	}
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	raw, err := client.InspectObject(chi.URLParam(r, "id"), key)
	if err != nil {
		writeGarageError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(raw)
}

func (s *Server) handleBucketPermission(w http.ResponseWriter, r *http.Request) {
	var body struct {
		AccessKeyID string `json:"access_key_id"`
		Read        bool   `json:"read"`
		Write       bool   `json:"write"`
		Owner       bool   `json:"owner"`
		Deny        bool   `json:"deny"`
	}
	if err := decodeJSON(r, &body); err != nil || body.AccessKeyID == "" {
		writeError(w, http.StatusBadRequest, "access_key_id is required")
		return
	}
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	perms := garage.Permissions{Read: body.Read, Write: body.Write, Owner: body.Owner}
	id := chi.URLParam(r, "id")
	if body.Deny {
		err = client.DenyBucketKey(id, body.AccessKeyID, perms)
	} else {
		err = client.AllowBucketKey(id, body.AccessKeyID, perms)
	}
	if err != nil {
		writeGarageError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
