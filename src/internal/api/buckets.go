package api

import (
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
		Alias string `json:"alias"`
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
	if err := client.AddBucketAlias(chi.URLParam(r, "id"), body.Alias); err != nil {
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
	if err := client.RemoveBucketAlias(chi.URLParam(r, "id"), chi.URLParam(r, "alias")); err != nil {
		writeGarageError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
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
