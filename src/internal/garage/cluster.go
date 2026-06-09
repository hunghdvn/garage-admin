package garage

import (
	"context"
	"encoding/json"
	"net/http"
)

// ClusterStatistics mirrors GetClusterStatistics.
type ClusterStatistics struct {
	Freeform            string `json:"freeform"`
	DataAvail           int64  `json:"dataAvail"`
	MetadataAvail       int64  `json:"metadataAvail"`
	IncompleteAvailInfo bool   `json:"incompleteAvailInfo"`
	BucketCount         int64  `json:"bucketCount"`
	TotalObjectCount    int64  `json:"totalObjectCount"`
	TotalObjectBytes    int64  `json:"totalObjectBytes"`
}

// LayoutRole is a node's role in the current layout.
type LayoutRole struct {
	ID               string   `json:"id"`
	Zone             string   `json:"zone"`
	Tags             []string `json:"tags"`
	Capacity         *int64   `json:"capacity"`
	StoredPartitions int      `json:"storedPartitions"`
	UsableCapacity   *int64   `json:"usableCapacity"`
}

// StagedRoleChange is a pending (not-yet-applied) role change.
type StagedRoleChange struct {
	ID       string   `json:"id"`
	Remove   bool     `json:"remove"`
	Zone     string   `json:"zone"`
	Capacity *int64   `json:"capacity"`
	Tags     []string `json:"tags"`
}

// ClusterLayout mirrors GetClusterLayout. ZoneRedundancy is left raw because it
// may be the string "maximum" or an object like {"atLeast":2}.
type ClusterLayout struct {
	Version           int                `json:"version"`
	Roles             []LayoutRole       `json:"roles"`
	Parameters        json.RawMessage    `json:"parameters"`
	PartitionSize     int64              `json:"partitionSize"`
	StagedRoleChanges []StagedRoleChange `json:"stagedRoleChanges"`
	StagedParameters  json.RawMessage    `json:"stagedParameters"`
}

// LayoutVersionInfo is one entry in the layout history.
type LayoutVersionInfo struct {
	Version      int    `json:"version"`
	Status       string `json:"status"`
	StorageNodes int    `json:"storageNodes"`
	GatewayNodes int    `json:"gatewayNodes"`
}

// LayoutHistory mirrors GetClusterLayoutHistory.
type LayoutHistory struct {
	CurrentVersion int                 `json:"currentVersion"`
	MinAck         int                 `json:"minAck"`
	Versions       []LayoutVersionInfo `json:"versions"`
	UpdateTrackers json.RawMessage     `json:"updateTrackers"`
}

// LayoutPreview mirrors PreviewClusterLayoutChanges / ApplyClusterLayout responses.
type LayoutPreview struct {
	Message   []string        `json:"message"`
	NewLayout json.RawMessage `json:"newLayout"`
}

// NodeRoleChange is one entry in the UpdateClusterLayout request array.
// To remove a node, set Remove=true. Otherwise Zone/Capacity/Tags must all be set
// (Capacity nil means a gateway node).
type NodeRoleChange struct {
	NodeID   string   `json:"nodeId"`
	Zone     string   `json:"zone,omitempty"`
	Capacity *int64   `json:"capacity"`
	Tags     []string `json:"tags,omitempty"`
	Remove   bool     `json:"remove,omitempty"`
}

// ConnectNodeResult is one entry of the ConnectClusterNodes response.
type ConnectNodeResult struct {
	Success bool    `json:"success"`
	Error   *string `json:"error"`
}

// GetClusterStatistics calls GET /v2/GetClusterStatistics.
func (c *Client) GetClusterStatistics() (*ClusterStatistics, error) {
	var out ClusterStatistics
	err := c.do(context.Background(), http.MethodGet, "/v2/GetClusterStatistics", nil, &out)
	return &out, err
}

// GetClusterLayout calls GET /v2/GetClusterLayout.
func (c *Client) GetClusterLayout() (*ClusterLayout, error) {
	var out ClusterLayout
	err := c.do(context.Background(), http.MethodGet, "/v2/GetClusterLayout", nil, &out)
	return &out, err
}

// GetClusterLayoutHistory calls GET /v2/GetClusterLayoutHistory.
func (c *Client) GetClusterLayoutHistory() (*LayoutHistory, error) {
	var out LayoutHistory
	err := c.do(context.Background(), http.MethodGet, "/v2/GetClusterLayoutHistory", nil, &out)
	return &out, err
}

// UpdateClusterLayout stages role changes. POST /v2/UpdateClusterLayout (array body).
func (c *Client) UpdateClusterLayout(changes []NodeRoleChange) (*ClusterLayout, error) {
	var out ClusterLayout
	err := c.do(context.Background(), http.MethodPost, "/v2/UpdateClusterLayout", changes, &out)
	return &out, err
}

// PreviewClusterLayoutChanges calls POST /v2/PreviewClusterLayoutChanges.
func (c *Client) PreviewClusterLayoutChanges() (*LayoutPreview, error) {
	var out LayoutPreview
	err := c.do(context.Background(), http.MethodPost, "/v2/PreviewClusterLayoutChanges", nil, &out)
	return &out, err
}

// ApplyClusterLayout applies staged changes for the given version.
func (c *Client) ApplyClusterLayout(version int) (*LayoutPreview, error) {
	var out LayoutPreview
	err := c.do(context.Background(), http.MethodPost, "/v2/ApplyClusterLayout", map[string]int{"version": version}, &out)
	return &out, err
}

// RevertClusterLayout discards staged changes. POST /v2/RevertClusterLayout.
func (c *Client) RevertClusterLayout() (*ClusterLayout, error) {
	var out ClusterLayout
	err := c.do(context.Background(), http.MethodPost, "/v2/RevertClusterLayout", map[string]any{}, &out)
	return &out, err
}

// ConnectClusterNodes calls POST /v2/ConnectClusterNodes with "id@addr" strings.
func (c *Client) ConnectClusterNodes(nodes []string) ([]ConnectNodeResult, error) {
	var out []ConnectNodeResult
	err := c.do(context.Background(), http.MethodPost, "/v2/ConnectClusterNodes", nodes, &out)
	return out, err
}
