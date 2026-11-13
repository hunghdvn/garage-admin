package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/HungHD/garage-admin/internal/db"
	"github.com/HungHD/garage-admin/internal/usage"
)

func (s *Server) mountUsage(r chi.Router) {
	r.Route("/usage", func(r chi.Router) {
		r.Use(s.Auth.RequireAuth)
		r.Get("/cluster", s.handleClusterUsage)
		r.Get("/buckets/{id}", s.handleBucketUsage)
	})
}

type usageSeries[T any] struct {
	Granularity usage.Granularity `json:"granularity"`
	Points      []T               `json:"points"`
}

// usageQuery parses ?range= and ?tzOffset= (minutes east of UTC) and resolves
// the cluster. It writes the error response itself and returns ok=false.
func (s *Server) usageQuery(w http.ResponseWriter, r *http.Request) (c *db.Cluster, since int64, g usage.Granularity, offsetSec int, ok bool) {
	offMin := 0
	if v := r.URL.Query().Get("tzOffset"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < -840 || n > 840 {
			writeError(w, http.StatusBadRequest, "invalid tzOffset")
			return
		}
		offMin = n
	}
	offsetSec = offMin * 60
	since, g, err := usage.RangeStart(time.Now(), r.URL.Query().Get("range"), offsetSec)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid range (24h, 7d, 30d, 90d, 365d)")
		return
	}
	c, err = s.clusterForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	return c, since, g, offsetSec, true
}

func shapeSeries[T any](rows []T, ts func(T) int64, g usage.Granularity, offsetSec int) usageSeries[T] {
	if g == usage.Day {
		rows = usage.LastPerDay(rows, ts, offsetSec)
	}
	if rows == nil {
		rows = []T{}
	}
	return usageSeries[T]{Granularity: g, Points: rows}
}

func (s *Server) handleClusterUsage(w http.ResponseWriter, r *http.Request) {
	c, since, g, off, ok := s.usageQuery(w, r)
	if !ok {
		return
	}
	rows, err := s.DB.ClusterUsageSince(c.ID, since)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "usage query failed")
		return
	}
	writeJSON(w, http.StatusOK, shapeSeries(rows, func(u db.ClusterUsage) int64 { return u.TS }, g, off))
}

func (s *Server) handleBucketUsage(w http.ResponseWriter, r *http.Request) {
	c, since, g, off, ok := s.usageQuery(w, r)
	if !ok {
		return
	}
	rows, err := s.DB.BucketUsageSince(c.ID, chi.URLParam(r, "id"), since)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "usage query failed")
		return
	}
	writeJSON(w, http.StatusOK, shapeSeries(rows, func(u db.BucketUsage) int64 { return u.TS }, g, off))
}
