package api

import (
	"io"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/HungHD/garage-admin/internal/s3"
)

func (s *Server) mountFiles(r chi.Router) {
	r.Route("/files", func(r chi.Router) {
		r.Use(s.Auth.RequireAuth)
		r.Get("/", s.handleListFiles)
		r.Get("/download", s.handleDownloadFile)
		r.With(s.Auth.RequireAdmin).Post("/upload", s.handleUploadFile)
		r.With(s.Auth.RequireAdmin).Post("/folder", s.handleCreateFolder)
		r.With(s.Auth.RequireAdmin).Delete("/", s.handleDeleteFile)
	})
}

// s3ClientForRequest builds an S3 client from the selected cluster's stored
// credentials. Cluster is chosen by ?cluster=, falling back to the default.
func (s *Server) s3ClientForRequest(r *http.Request) (s3.Client, error) {
	c, err := s.clusterForRequest(r)
	if err != nil {
		return nil, err
	}
	if c.S3AccessKey == "" || c.S3SecretKeyEnc == "" {
		return nil, errS3NotConfigured
	}
	secret, err := s.Cipher.Decrypt(c.S3SecretKeyEnc)
	if err != nil {
		return nil, err
	}
	return s.NewS3(c.S3Endpoint, c.S3Region, c.S3AccessKey, secret)
}

func (s *Server) handleListFiles(w http.ResponseWriter, r *http.Request) {
	bucket := r.URL.Query().Get("bucket")
	if bucket == "" {
		writeError(w, http.StatusBadRequest, "bucket is required")
		return
	}
	client, err := s.s3ClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	entries, err := client.List(r.Context(), bucket, r.URL.Query().Get("prefix"))
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, entries)
}

func (s *Server) handleDownloadFile(w http.ResponseWriter, r *http.Request) {
	bucket := r.URL.Query().Get("bucket")
	key := r.URL.Query().Get("key")
	if bucket == "" || key == "" {
		writeError(w, http.StatusBadRequest, "bucket and key are required")
		return
	}
	client, err := s.s3ClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	obj, err := client.Get(r.Context(), bucket, key)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	defer obj.Body.Close()
	name := key
	if i := strings.LastIndex(key, "/"); i >= 0 {
		name = key[i+1:]
	}
	if obj.ContentType != "" {
		w.Header().Set("Content-Type", obj.ContentType)
	}
	w.Header().Set("Content-Disposition", "attachment; filename=\""+name+"\"")
	io.Copy(w, obj.Body)
}

func (s *Server) handleUploadFile(w http.ResponseWriter, r *http.Request) {
	bucket := r.URL.Query().Get("bucket")
	key := r.URL.Query().Get("key")
	if bucket == "" || key == "" {
		writeError(w, http.StatusBadRequest, "bucket and key are required")
		return
	}
	client, err := s.s3ClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	defer r.Body.Close()
	if err := client.Put(r.Context(), bucket, key, r.Body, r.ContentLength, r.Header.Get("Content-Type")); err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleCreateFolder(w http.ResponseWriter, r *http.Request) {
	bucket := r.URL.Query().Get("bucket")
	prefix := r.URL.Query().Get("prefix")
	if bucket == "" || prefix == "" {
		writeError(w, http.StatusBadRequest, "bucket and prefix are required")
		return
	}
	key := strings.TrimSuffix(prefix, "/") + "/"
	client, err := s.s3ClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := client.Put(r.Context(), bucket, key, strings.NewReader(""), 0, ""); err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleDeleteFile(w http.ResponseWriter, r *http.Request) {
	bucket := r.URL.Query().Get("bucket")
	key := r.URL.Query().Get("key")
	if bucket == "" || key == "" {
		writeError(w, http.StatusBadRequest, "bucket and key are required")
		return
	}
	client, err := s.s3ClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := client.Delete(r.Context(), bucket, key); err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
