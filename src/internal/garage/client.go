// Package garage is a typed client for the Garage Admin API v2.
package garage

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Client talks to a single Garage cluster's Admin API.
type Client struct {
	endpoint string
	token    string
	http     *http.Client
}

// APIError is returned by the client when Garage responds with a non-2xx status.
type APIError struct {
	StatusCode int
	Code       string // Garage error code, e.g. "InvalidRequest"
	Message    string // human-readable message from Garage
	Raw        string // raw response body
}

func (e *APIError) Error() string {
	if e.Message != "" {
		return fmt.Sprintf("garage %d %s: %s", e.StatusCode, e.Code, e.Message)
	}
	return fmt.Sprintf("garage %d: %s", e.StatusCode, e.Raw)
}

// New creates a client. endpoint is like "http://192.168.101.8:3903".
func New(endpoint, token string) *Client {
	return &Client{
		endpoint: strings.TrimRight(endpoint, "/"),
		token:    token,
		http:     &http.Client{Timeout: 15 * time.Second},
	}
}

// ClusterHealth mirrors GetClusterHealth response.
type ClusterHealth struct {
	Status           string `json:"status"`
	KnownNodes       int    `json:"knownNodes"`
	ConnectedNodes   int    `json:"connectedNodes"`
	StorageNodes     int    `json:"storageNodes"`
	StorageNodesOk   int    `json:"storageNodesOk"`
	Partitions       int    `json:"partitions"`
	PartitionsQuorum int    `json:"partitionsQuorum"`
	PartitionsAllOk  int    `json:"partitionsAllOk"`
}

// GetClusterHealth calls GET /v2/GetClusterHealth.
func (c *Client) GetClusterHealth() (*ClusterHealth, error) {
	var out ClusterHealth
	if err := c.do(context.Background(), http.MethodGet, "/v2/GetClusterHealth", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// GetClusterStatus returns the raw cluster status JSON (typed later as needed).
func (c *Client) GetClusterStatus() (map[string]any, error) {
	var out map[string]any
	if err := c.do(context.Background(), http.MethodGet, "/v2/GetClusterStatus", nil, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// do performs an Admin API request and decodes the JSON response into out.
func (c *Client) do(ctx context.Context, method, path string, body, out any) error {
	var reader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = strings.NewReader(string(b))
	}
	req, err := http.NewRequestWithContext(ctx, method, c.endpoint+path, reader)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		ae := &APIError{StatusCode: resp.StatusCode, Raw: string(data)}
		var parsed struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		}
		if json.Unmarshal(data, &parsed) == nil {
			ae.Code = parsed.Code
			ae.Message = parsed.Message
		}
		return ae
	}
	if out != nil && len(data) > 0 {
		if err := json.Unmarshal(data, out); err != nil {
			return fmt.Errorf("garage: decode %s: %w", path, err)
		}
	}
	return nil
}
