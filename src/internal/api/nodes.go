package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

// nodeParam returns the ?node= value, defaulting to "self".
func nodeParam(r *http.Request) string {
	n := r.URL.Query().Get("node")
	if n == "" {
		return "self"
	}
	return n
}

func (s *Server) mountNodes(r chi.Router) {
	r.Route("/nodes", func(r chi.Router) {
		r.Use(s.Auth.RequireAuth)
		// reads
		r.Get("/info", s.handleNodeInfo)
		r.Get("/statistics", s.handleNodeStatistics)
		r.Get("/workers", s.handleListWorkers)
		r.Post("/workers/info", s.handleWorkerInfo)
		r.Get("/workers/variable", s.handleGetWorkerVariable)
		r.Get("/blocks/errors", s.handleListBlockErrors)
		r.Post("/blocks/info", s.handleGetBlockInfo)
		// mutations (admin)
		r.With(s.Auth.RequireAdmin).Post("/workers/variable", s.handleSetWorkerVariable)
		r.With(s.Auth.RequireAdmin).Post("/snapshot", s.handleMetadataSnapshot)
		r.With(s.Auth.RequireAdmin).Post("/repair", s.handleRepair)
		r.With(s.Auth.RequireAdmin).Post("/blocks/retry", s.handleRetryBlocks)
		r.With(s.Auth.RequireAdmin).Post("/blocks/purge", s.handlePurgeBlocks)
	})
}

// writeRaw emits a json.RawMessage from a garage passthrough call.
func (s *Server) writeRaw(w http.ResponseWriter, raw []byte, err error) {
	if err != nil {
		writeGarageError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write(raw)
}

func (s *Server) handleNodeInfo(w http.ResponseWriter, r *http.Request) {
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	raw, err := client.GetNodeInfo(nodeParam(r))
	s.writeRaw(w, raw, err)
}

func (s *Server) handleNodeStatistics(w http.ResponseWriter, r *http.Request) {
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	raw, err := client.GetNodeStatistics(nodeParam(r))
	s.writeRaw(w, raw, err)
}

func (s *Server) handleListWorkers(w http.ResponseWriter, r *http.Request) {
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	busy := r.URL.Query().Get("busy") == "1"
	errOnly := r.URL.Query().Get("error") == "1"
	raw, err := client.ListWorkers(nodeParam(r), busy, errOnly)
	s.writeRaw(w, raw, err)
}

func (s *Server) handleWorkerInfo(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ID uint64 `json:"id"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "id is required")
		return
	}
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	raw, err := client.GetWorkerInfo(nodeParam(r), body.ID)
	s.writeRaw(w, raw, err)
}

func (s *Server) handleGetWorkerVariable(w http.ResponseWriter, r *http.Request) {
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	raw, err := client.GetWorkerVariable(nodeParam(r), r.URL.Query().Get("variable"))
	s.writeRaw(w, raw, err)
}

func (s *Server) handleSetWorkerVariable(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Variable string `json:"variable"`
		Value    string `json:"value"`
	}
	if err := decodeJSON(r, &body); err != nil || body.Variable == "" {
		writeError(w, http.StatusBadRequest, "variable and value are required")
		return
	}
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	raw, err := client.SetWorkerVariable(nodeParam(r), body.Variable, body.Value)
	s.writeRaw(w, raw, err)
}

func (s *Server) handleMetadataSnapshot(w http.ResponseWriter, r *http.Request) {
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	raw, err := client.CreateMetadataSnapshot(nodeParam(r))
	s.writeRaw(w, raw, err)
}

func (s *Server) handleRepair(w http.ResponseWriter, r *http.Request) {
	var body struct {
		RepairType string `json:"repair_type"`
	}
	if err := decodeJSON(r, &body); err != nil || body.RepairType == "" {
		writeError(w, http.StatusBadRequest, "repair_type is required")
		return
	}
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	raw, err := client.LaunchRepairOperation(nodeParam(r), body.RepairType)
	s.writeRaw(w, raw, err)
}

func (s *Server) handleListBlockErrors(w http.ResponseWriter, r *http.Request) {
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	raw, err := client.ListBlockErrors(nodeParam(r))
	s.writeRaw(w, raw, err)
}

func (s *Server) handleGetBlockInfo(w http.ResponseWriter, r *http.Request) {
	var body struct {
		BlockHash string `json:"block_hash"`
	}
	if err := decodeJSON(r, &body); err != nil || body.BlockHash == "" {
		writeError(w, http.StatusBadRequest, "block_hash is required")
		return
	}
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	raw, err := client.GetBlockInfo(nodeParam(r), body.BlockHash)
	s.writeRaw(w, raw, err)
}

func (s *Server) handleRetryBlocks(w http.ResponseWriter, r *http.Request) {
	var body struct {
		All         bool     `json:"all"`
		BlockHashes []string `json:"block_hashes"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if !body.All && len(body.BlockHashes) == 0 {
		writeError(w, http.StatusBadRequest, "either all=true or block_hashes is required")
		return
	}
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	raw, err := client.RetryBlockResync(nodeParam(r), body.All, body.BlockHashes)
	s.writeRaw(w, raw, err)
}

func (s *Server) handlePurgeBlocks(w http.ResponseWriter, r *http.Request) {
	var body struct {
		BlockHashes []string `json:"block_hashes"`
	}
	if err := decodeJSON(r, &body); err != nil || len(body.BlockHashes) == 0 {
		writeError(w, http.StatusBadRequest, "block_hashes are required")
		return
	}
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	raw, err := client.PurgeBlocks(nodeParam(r), body.BlockHashes)
	s.writeRaw(w, raw, err)
}
