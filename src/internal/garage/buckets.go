package garage

import (
	"context"
	"net/http"
	"net/url"
)

// Permissions are read/write/owner flags for a key on a bucket.
type Permissions struct {
	Read  bool `json:"read"`
	Write bool `json:"write"`
	Owner bool `json:"owner"`
}

// Quotas are bucket quotas; nil pointer means unlimited.
type Quotas struct {
	MaxSize    *int64 `json:"maxSize"`
	MaxObjects *int64 `json:"maxObjects"`
}

// WebsiteConfig is present when website access is enabled.
type WebsiteConfig struct {
	IndexDocument string `json:"indexDocument"`
	ErrorDocument string `json:"errorDocument"`
}

// BucketListItem is one entry from ListBuckets.
type BucketListItem struct {
	ID            string   `json:"id"`
	Created       string   `json:"created"`
	GlobalAliases []string `json:"globalAliases"`
	LocalAliases  []any    `json:"localAliases"`
}

// BucketKeyPerm is a key's permission on a bucket (within BucketInfo).
type BucketKeyPerm struct {
	AccessKeyID        string      `json:"accessKeyId"`
	Name               string      `json:"name"`
	Permissions        Permissions `json:"permissions"`
	BucketLocalAliases []string    `json:"bucketLocalAliases"`
}

// BucketInfo is the detailed bucket view.
type BucketInfo struct {
	ID                         string          `json:"id"`
	Created                    string          `json:"created"`
	GlobalAliases              []string        `json:"globalAliases"`
	WebsiteAccess              bool            `json:"websiteAccess"`
	WebsiteConfig              *WebsiteConfig  `json:"websiteConfig"`
	Keys                       []BucketKeyPerm `json:"keys"`
	Objects                    int64           `json:"objects"`
	Bytes                      int64           `json:"bytes"`
	UnfinishedUploads          int64           `json:"unfinishedUploads"`
	UnfinishedMultipartUploads int64           `json:"unfinishedMultipartUploads"`
	Quotas                     Quotas          `json:"quotas"`
}

// WebsiteAccessUpdate configures static website hosting on UpdateBucket.
type WebsiteAccessUpdate struct {
	Enabled       bool   `json:"enabled"`
	IndexDocument string `json:"indexDocument,omitempty"`
	ErrorDocument string `json:"errorDocument,omitempty"`
}

// UpdateBucketRequest is the body for UpdateBucket. Nil fields are omitted.
type UpdateBucketRequest struct {
	WebsiteAccess *WebsiteAccessUpdate `json:"websiteAccess,omitempty"`
	Quotas        *Quotas              `json:"quotas,omitempty"`
}

// ListBuckets calls GET /v2/ListBuckets.
func (c *Client) ListBuckets() ([]BucketListItem, error) {
	var out []BucketListItem
	err := c.do(context.Background(), http.MethodGet, "/v2/ListBuckets", nil, &out)
	return out, err
}

// GetBucketInfo calls GET /v2/GetBucketInfo?id=.
func (c *Client) GetBucketInfo(id string) (*BucketInfo, error) {
	var out BucketInfo
	err := c.do(context.Background(), http.MethodGet, "/v2/GetBucketInfo?id="+url.QueryEscape(id), nil, &out)
	return &out, err
}

// CreateBucket calls POST /v2/CreateBucket with a global alias.
func (c *Client) CreateBucket(globalAlias string) (*BucketInfo, error) {
	var out BucketInfo
	body := map[string]string{"globalAlias": globalAlias}
	err := c.do(context.Background(), http.MethodPost, "/v2/CreateBucket", body, &out)
	return &out, err
}

// UpdateBucket calls POST /v2/UpdateBucket?id=.
func (c *Client) UpdateBucket(id string, req UpdateBucketRequest) (*BucketInfo, error) {
	var out BucketInfo
	err := c.do(context.Background(), http.MethodPost, "/v2/UpdateBucket?id="+url.QueryEscape(id), req, &out)
	return &out, err
}

// DeleteBucket calls POST /v2/DeleteBucket?id=.
func (c *Client) DeleteBucket(id string) error {
	return c.do(context.Background(), http.MethodPost, "/v2/DeleteBucket?id="+url.QueryEscape(id), nil, nil)
}

// AddBucketAlias calls POST /v2/AddBucketAlias with a global alias.
func (c *Client) AddBucketAlias(bucketID, globalAlias string) error {
	body := map[string]string{"bucketId": bucketID, "globalAlias": globalAlias}
	return c.do(context.Background(), http.MethodPost, "/v2/AddBucketAlias", body, nil)
}

// RemoveBucketAlias calls POST /v2/RemoveBucketAlias for a global alias.
func (c *Client) RemoveBucketAlias(bucketID, globalAlias string) error {
	body := map[string]string{"bucketId": bucketID, "globalAlias": globalAlias}
	return c.do(context.Background(), http.MethodPost, "/v2/RemoveBucketAlias", body, nil)
}

// AllowBucketKey grants permissions for a key on a bucket.
func (c *Client) AllowBucketKey(bucketID, accessKeyID string, perms Permissions) error {
	body := map[string]any{"bucketId": bucketID, "accessKeyId": accessKeyID, "permissions": perms}
	return c.do(context.Background(), http.MethodPost, "/v2/AllowBucketKey", body, nil)
}

// DenyBucketKey revokes permissions for a key on a bucket.
func (c *Client) DenyBucketKey(bucketID, accessKeyID string, perms Permissions) error {
	body := map[string]any{"bucketId": bucketID, "accessKeyId": accessKeyID, "permissions": perms}
	return c.do(context.Background(), http.MethodPost, "/v2/DenyBucketKey", body, nil)
}
