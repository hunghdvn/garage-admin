package garage

import (
	"context"
	"net/http"
	"net/url"
)

// KeyListItem is one entry from ListKeys.
type KeyListItem struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	Created    string  `json:"created"`
	Expiration *string `json:"expiration"`
	Expired    bool    `json:"expired"`
}

// KeyPermissions are global key permissions.
type KeyPermissions struct {
	CreateBucket bool `json:"createBucket"`
}

// KeyBucketPerm is a bucket a key has access to (within KeyInfo).
type KeyBucketPerm struct {
	ID            string      `json:"id"`
	GlobalAliases []string    `json:"globalAliases"`
	LocalAliases  []string    `json:"localAliases"`
	Permissions   Permissions `json:"permissions"`
}

// KeyInfo is the detailed key view. SecretAccessKey is only present on
// create/import or when showSecretKey was requested.
type KeyInfo struct {
	AccessKeyID     string          `json:"accessKeyId"`
	SecretAccessKey *string         `json:"secretAccessKey,omitempty"`
	Created         string          `json:"created"`
	Name            string          `json:"name"`
	Expiration      *string         `json:"expiration"`
	Expired         bool            `json:"expired"`
	Permissions     KeyPermissions  `json:"permissions"`
	Buckets         []KeyBucketPerm `json:"buckets"`
}

// UpdateKeyRequest is the body for UpdateKey. Nil/zero fields are omitted.
type UpdateKeyRequest struct {
	Name         *string         `json:"name,omitempty"`
	Expiration   *string         `json:"expiration,omitempty"`
	NeverExpires bool            `json:"neverExpires,omitempty"`
	Allow        *KeyPermissions `json:"allow,omitempty"`
	Deny         *KeyPermissions `json:"deny,omitempty"`
}

// KeyCreateRequest is the body for CreateKey.
type KeyCreateRequest struct {
	Name         string  `json:"name"`
	Expiration   *string `json:"expiration,omitempty"`
	NeverExpires bool    `json:"neverExpires,omitempty"`
}

// ListKeys calls GET /v2/ListKeys.
func (c *Client) ListKeys() ([]KeyListItem, error) {
	var out []KeyListItem
	err := c.do(context.Background(), http.MethodGet, "/v2/ListKeys", nil, &out)
	return out, err
}

// GetKeyInfo calls GET /v2/GetKeyInfo?id=. If showSecret, the secret is revealed.
func (c *Client) GetKeyInfo(id string, showSecret bool) (*KeyInfo, error) {
	path := "/v2/GetKeyInfo?id=" + url.QueryEscape(id)
	if showSecret {
		path += "&showSecretKey=true"
	}
	var out KeyInfo
	err := c.do(context.Background(), http.MethodGet, path, nil, &out)
	return &out, err
}

// CreateKey calls POST /v2/CreateKey. The response includes the secret.
func (c *Client) CreateKey(req KeyCreateRequest) (*KeyInfo, error) {
	var out KeyInfo
	err := c.do(context.Background(), http.MethodPost, "/v2/CreateKey", req, &out)
	return &out, err
}

// UpdateKey calls POST /v2/UpdateKey?id=.
func (c *Client) UpdateKey(id string, req UpdateKeyRequest) (*KeyInfo, error) {
	var out KeyInfo
	err := c.do(context.Background(), http.MethodPost, "/v2/UpdateKey?id="+url.QueryEscape(id), req, &out)
	return &out, err
}

// DeleteKey calls POST /v2/DeleteKey?id=.
func (c *Client) DeleteKey(id string) error {
	return c.do(context.Background(), http.MethodPost, "/v2/DeleteKey?id="+url.QueryEscape(id), nil, nil)
}

// ImportKey calls POST /v2/ImportKey.
func (c *Client) ImportKey(accessKeyID, secretAccessKey, name string) (*KeyInfo, error) {
	body := map[string]string{"accessKeyId": accessKeyID, "secretAccessKey": secretAccessKey, "name": name}
	var out KeyInfo
	err := c.do(context.Background(), http.MethodPost, "/v2/ImportKey", body, &out)
	return &out, err
}
