package garage

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
)

// nodeRaw performs a node-scoped request (?node=) and returns the raw multi-node
// envelope JSON ({"success":{nodeId:...},"error":{nodeId:msg}}) for passthrough.
func (c *Client) nodeRaw(method, op, node string, body any) (json.RawMessage, error) {
	var out json.RawMessage
	path := "/v2/" + op + "?node=" + url.QueryEscape(node)
	err := c.do(context.Background(), method, path, body, &out)
	return out, err
}

// GetNodeInfo: GET /v2/GetNodeInfo?node=
func (c *Client) GetNodeInfo(node string) (json.RawMessage, error) {
	return c.nodeRaw(http.MethodGet, "GetNodeInfo", node, nil)
}

// GetNodeStatistics: GET /v2/GetNodeStatistics?node=
func (c *Client) GetNodeStatistics(node string) (json.RawMessage, error) {
	return c.nodeRaw(http.MethodGet, "GetNodeStatistics", node, nil)
}

// ListWorkers: POST /v2/ListWorkers?node= {busyOnly,errorOnly}
func (c *Client) ListWorkers(node string, busyOnly, errorOnly bool) (json.RawMessage, error) {
	return c.nodeRaw(http.MethodPost, "ListWorkers", node,
		map[string]bool{"busyOnly": busyOnly, "errorOnly": errorOnly})
}

// GetWorkerInfo: POST /v2/GetWorkerInfo?node= {id}
func (c *Client) GetWorkerInfo(node string, id uint64) (json.RawMessage, error) {
	return c.nodeRaw(http.MethodPost, "GetWorkerInfo", node, map[string]uint64{"id": id})
}

// GetWorkerVariable: POST /v2/GetWorkerVariable?node= {variable}
// An empty variable is sent as null (Garage returns all variables).
func (c *Client) GetWorkerVariable(node, variable string) (json.RawMessage, error) {
	var v *string
	if variable != "" {
		v = &variable
	}
	return c.nodeRaw(http.MethodPost, "GetWorkerVariable", node, map[string]*string{"variable": v})
}

// SetWorkerVariable: POST /v2/SetWorkerVariable?node= {variable,value}
func (c *Client) SetWorkerVariable(node, variable, value string) (json.RawMessage, error) {
	return c.nodeRaw(http.MethodPost, "SetWorkerVariable", node,
		map[string]string{"variable": variable, "value": value})
}

// CreateMetadataSnapshot: POST /v2/CreateMetadataSnapshot?node= (no body)
func (c *Client) CreateMetadataSnapshot(node string) (json.RawMessage, error) {
	return c.nodeRaw(http.MethodPost, "CreateMetadataSnapshot", node, nil)
}

// LaunchRepairOperation: POST /v2/LaunchRepairOperation?node= {repairType}
func (c *Client) LaunchRepairOperation(node, repairType string) (json.RawMessage, error) {
	return c.nodeRaw(http.MethodPost, "LaunchRepairOperation", node,
		map[string]string{"repairType": repairType})
}

// ListBlockErrors: GET /v2/ListBlockErrors?node=
func (c *Client) ListBlockErrors(node string) (json.RawMessage, error) {
	return c.nodeRaw(http.MethodGet, "ListBlockErrors", node, nil)
}

// GetBlockInfo: POST /v2/GetBlockInfo?node= {blockHash}
func (c *Client) GetBlockInfo(node, blockHash string) (json.RawMessage, error) {
	return c.nodeRaw(http.MethodPost, "GetBlockInfo", node, map[string]string{"blockHash": blockHash})
}

// RetryBlockResync: POST /v2/RetryBlockResync?node= — body is {all:true} OR {blockHashes:[...]}.
func (c *Client) RetryBlockResync(node string, all bool, blockHashes []string) (json.RawMessage, error) {
	var body any
	if all {
		body = map[string]bool{"all": true}
	} else {
		body = map[string][]string{"blockHashes": blockHashes}
	}
	return c.nodeRaw(http.MethodPost, "RetryBlockResync", node, body)
}

// PurgeBlocks: POST /v2/PurgeBlocks?node= — body is a bare array of block hashes.
func (c *Client) PurgeBlocks(node string, blockHashes []string) (json.RawMessage, error) {
	return c.nodeRaw(http.MethodPost, "PurgeBlocks", node, blockHashes)
}
