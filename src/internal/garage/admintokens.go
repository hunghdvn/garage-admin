package garage

import (
	"context"
	"net/http"
	"net/url"
)

// AdminTokenInfo is an admin token as returned by the list/get/current endpoints.
// ID and Created are null for tokens defined in the daemon configuration file.
type AdminTokenInfo struct {
	ID          *string  `json:"id"`
	Created     *string  `json:"created"`
	Name        string   `json:"name"`
	Expiration  *string  `json:"expiration"`
	Expired     bool     `json:"expired"`
	Scope       []string `json:"scope"`
	SecretToken *string  `json:"secretToken,omitempty"` // only present on create
}

// AdminTokenRequest is the body for CreateAdminToken / UpdateAdminToken.
type AdminTokenRequest struct {
	Name         string   `json:"name"`
	Scope        []string `json:"scope"`
	Expiration   *string  `json:"expiration,omitempty"`
	NeverExpires *bool    `json:"neverExpires,omitempty"`
}

// ListAdminTokens calls GET /v2/ListAdminTokens.
func (c *Client) ListAdminTokens() ([]AdminTokenInfo, error) {
	var out []AdminTokenInfo
	err := c.do(context.Background(), http.MethodGet, "/v2/ListAdminTokens", nil, &out)
	return out, err
}

// GetCurrentAdminTokenInfo calls GET /v2/GetCurrentAdminTokenInfo.
func (c *Client) GetCurrentAdminTokenInfo() (*AdminTokenInfo, error) {
	var out AdminTokenInfo
	err := c.do(context.Background(), http.MethodGet, "/v2/GetCurrentAdminTokenInfo", nil, &out)
	return &out, err
}

// GetAdminTokenInfo calls GET /v2/GetAdminTokenInfo?id=.
func (c *Client) GetAdminTokenInfo(id string) (*AdminTokenInfo, error) {
	var out AdminTokenInfo
	err := c.do(context.Background(), http.MethodGet, "/v2/GetAdminTokenInfo?id="+url.QueryEscape(id), nil, &out)
	return &out, err
}

// CreateAdminToken calls POST /v2/CreateAdminToken. The response includes secretToken once.
func (c *Client) CreateAdminToken(req AdminTokenRequest) (*AdminTokenInfo, error) {
	var out AdminTokenInfo
	err := c.do(context.Background(), http.MethodPost, "/v2/CreateAdminToken", req, &out)
	return &out, err
}

// UpdateAdminToken calls POST /v2/UpdateAdminToken?id=.
func (c *Client) UpdateAdminToken(id string, req AdminTokenRequest) (*AdminTokenInfo, error) {
	var out AdminTokenInfo
	err := c.do(context.Background(), http.MethodPost, "/v2/UpdateAdminToken?id="+url.QueryEscape(id), req, &out)
	return &out, err
}

// DeleteAdminToken calls POST /v2/DeleteAdminToken?id=.
func (c *Client) DeleteAdminToken(id string) error {
	return c.do(context.Background(), http.MethodPost, "/v2/DeleteAdminToken?id="+url.QueryEscape(id), nil, nil)
}
