package api

import (
	"net/http"

	"github.com/HungHD/garage-admin/internal/garage"
)

func (s *Server) handleClusterStatistics(w http.ResponseWriter, r *http.Request) {
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	stats, err := client.GetClusterStatistics()
	if err != nil {
		writeGarageError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, stats)
}

func (s *Server) handleGetLayout(w http.ResponseWriter, r *http.Request) {
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	layout, err := client.GetClusterLayout()
	if err != nil {
		writeGarageError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, layout)
}

func (s *Server) handleLayoutHistory(w http.ResponseWriter, r *http.Request) {
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	hist, err := client.GetClusterLayoutHistory()
	if err != nil {
		writeGarageError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, hist)
}

func (s *Server) handleStageLayout(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Changes []struct {
			NodeID   string   `json:"node_id"`
			Zone     string   `json:"zone"`
			Capacity *int64   `json:"capacity"`
			Tags     []string `json:"tags"`
			Remove   bool     `json:"remove"`
		} `json:"changes"`
	}
	if err := decodeJSON(r, &body); err != nil || len(body.Changes) == 0 {
		writeError(w, http.StatusBadRequest, "changes are required")
		return
	}
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	changes := make([]garage.NodeRoleChange, 0, len(body.Changes))
	for _, c := range body.Changes {
		tags := c.Tags
		if tags == nil {
			tags = []string{}
		}
		changes = append(changes, garage.NodeRoleChange{
			NodeID: c.NodeID, Zone: c.Zone, Capacity: c.Capacity, Tags: tags, Remove: c.Remove,
		})
	}
	layout, err := client.UpdateClusterLayout(changes)
	if err != nil {
		writeGarageError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, layout)
}

func (s *Server) handlePreviewLayout(w http.ResponseWriter, r *http.Request) {
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	prev, err := client.PreviewClusterLayoutChanges()
	if err != nil {
		writeGarageError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, prev)
}

func (s *Server) handleApplyLayout(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Version int `json:"version"`
	}
	if err := decodeJSON(r, &body); err != nil || body.Version == 0 {
		writeError(w, http.StatusBadRequest, "version is required")
		return
	}
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	res, err := client.ApplyClusterLayout(body.Version)
	if err != nil {
		writeGarageError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (s *Server) handleRevertLayout(w http.ResponseWriter, r *http.Request) {
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	layout, err := client.RevertClusterLayout()
	if err != nil {
		writeGarageError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, layout)
}

func (s *Server) handleConnectNodes(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Nodes []string `json:"nodes"`
	}
	if err := decodeJSON(r, &body); err != nil || len(body.Nodes) == 0 {
		writeError(w, http.StatusBadRequest, "nodes are required")
		return
	}
	client, err := s.garageClientForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "no cluster configured")
		return
	}
	res, err := client.ConnectClusterNodes(body.Nodes)
	if err != nil {
		writeGarageError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}
