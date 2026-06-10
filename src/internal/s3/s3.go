// Package s3 wraps an S3-compatible client (minio-go) for the file browser.
package s3

import (
	"context"
	"errors"
	"io"
	"net/url"
	"strings"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// Entry is one item in a bucket listing — a folder (IsDir) or an object.
type Entry struct {
	Key          string `json:"key"`
	Name         string `json:"name"`
	IsDir        bool   `json:"is_dir"`
	Size         int64  `json:"size"`
	LastModified string `json:"last_modified"`
}

// Object is a downloadable object stream.
type Object struct {
	Body        io.ReadCloser
	ContentType string
	Size        int64
}

// Client is the S3 surface used by the API handlers (mockable in tests).
type Client interface {
	List(ctx context.Context, bucket, prefix string) ([]Entry, error)
	Get(ctx context.Context, bucket, key string) (*Object, error)
	Put(ctx context.Context, bucket, key string, r io.Reader, size int64, contentType string) error
	Delete(ctx context.Context, bucket, key string) error
}

type minioClient struct{ mc *minio.Client }

// New builds an S3 client from an endpoint URL and static credentials.
func New(endpoint, region, accessKey, secretKey string) (Client, error) {
	host, secure, err := parseEndpoint(endpoint)
	if err != nil {
		return nil, err
	}
	mc, err := minio.New(host, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: secure,
		Region: region,
	})
	if err != nil {
		return nil, err
	}
	return &minioClient{mc: mc}, nil
}

// parseEndpoint splits a URL into host[:port] and a secure flag. A bare
// host:port (no scheme) is treated as insecure (http).
func parseEndpoint(endpoint string) (host string, secure bool, err error) {
	if !strings.Contains(endpoint, "://") {
		return endpoint, false, nil
	}
	u, err := url.Parse(endpoint)
	if err != nil {
		return "", false, err
	}
	if u.Host == "" {
		return "", false, errors.New("invalid endpoint")
	}
	return u.Host, u.Scheme == "https", nil
}

// entryFromKey maps an object key (relative to prefix) into an Entry.
func entryFromKey(key, prefix string, size int64, lastModified string) Entry {
	rel := strings.TrimPrefix(key, prefix)
	if strings.HasSuffix(key, "/") {
		return Entry{Key: key, Name: strings.TrimSuffix(rel, "/"), IsDir: true}
	}
	return Entry{Key: key, Name: rel, IsDir: false, Size: size, LastModified: lastModified}
}

// List returns the immediate children (folders + files) under prefix.
func (c *minioClient) List(ctx context.Context, bucket, prefix string) ([]Entry, error) {
	out := []Entry{}
	for obj := range c.mc.ListObjects(ctx, bucket, minio.ListObjectsOptions{Prefix: prefix, Recursive: false}) {
		if obj.Err != nil {
			return nil, obj.Err
		}
		if obj.Key == prefix {
			continue // skip the folder marker object equal to the prefix itself
		}
		lm := ""
		if !obj.LastModified.IsZero() {
			lm = obj.LastModified.UTC().Format("2006-01-02T15:04:05Z")
		}
		out = append(out, entryFromKey(obj.Key, prefix, obj.Size, lm))
	}
	return out, nil
}

// Get opens an object for streaming download.
func (c *minioClient) Get(ctx context.Context, bucket, key string) (*Object, error) {
	obj, err := c.mc.GetObject(ctx, bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, err
	}
	info, err := obj.Stat()
	if err != nil {
		obj.Close()
		return nil, err
	}
	return &Object{Body: obj, ContentType: info.ContentType, Size: info.Size}, nil
}

// Put uploads an object, streaming from r. size may be -1 if unknown.
func (c *minioClient) Put(ctx context.Context, bucket, key string, r io.Reader, size int64, contentType string) error {
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	_, err := c.mc.PutObject(ctx, bucket, key, r, size, minio.PutObjectOptions{ContentType: contentType})
	return err
}

// Delete removes an object.
func (c *minioClient) Delete(ctx context.Context, bucket, key string) error {
	return c.mc.RemoveObject(ctx, bucket, key, minio.RemoveObjectOptions{})
}
