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

// APIError carries the HTTP status and message of an S3 error so the API layer
// can surface client errors (403 quota, 404 not found, ...) with the right status
// instead of a blanket 502.
type APIError struct {
	StatusCode int
	Code       string
	Message    string
}

func (e *APIError) Error() string {
	if e.Message != "" {
		return e.Message
	}
	return e.Code
}

// wrapErr converts a minio error into an *APIError when it carries an HTTP status.
func wrapErr(err error) error {
	if err == nil {
		return nil
	}
	resp := minio.ToErrorResponse(err)
	if resp.StatusCode != 0 {
		msg := resp.Message
		if msg == "" {
			msg = resp.Code
		}
		return &APIError{StatusCode: resp.StatusCode, Code: resp.Code, Message: msg}
	}
	return err
}

// Client is the S3 surface used by the API handlers (mockable in tests).
type Client interface {
	List(ctx context.Context, bucket, prefix string) ([]Entry, error)
	Get(ctx context.Context, bucket, key string) (*Object, error)
	Put(ctx context.Context, bucket, key string, r io.Reader, size int64, contentType string) error
	Delete(ctx context.Context, bucket, key string) error
	// Move renames a single object (copy then delete the source).
	Move(ctx context.Context, bucket, srcKey, dstKey string) error
	// DeletePrefix removes every object under prefix (recursive folder delete).
	DeletePrefix(ctx context.Context, bucket, prefix string) error
	// MovePrefix renames a folder: copies every object from srcPrefix to dstPrefix
	// then deletes the originals. Both prefixes end with "/".
	MovePrefix(ctx context.Context, bucket, srcPrefix, dstPrefix string) error
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
			return nil, wrapErr(obj.Err)
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
		return nil, wrapErr(err)
	}
	info, err := obj.Stat()
	if err != nil {
		obj.Close()
		return nil, wrapErr(err)
	}
	return &Object{Body: obj, ContentType: info.ContentType, Size: info.Size}, nil
}

// Put uploads an object, streaming from r. size may be -1 if unknown.
func (c *minioClient) Put(ctx context.Context, bucket, key string, r io.Reader, size int64, contentType string) error {
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	_, err := c.mc.PutObject(ctx, bucket, key, r, size, minio.PutObjectOptions{ContentType: contentType})
	return wrapErr(err)
}

// Delete removes an object.
func (c *minioClient) Delete(ctx context.Context, bucket, key string) error {
	return wrapErr(c.mc.RemoveObject(ctx, bucket, key, minio.RemoveObjectOptions{}))
}

// Move renames a single object: copy to the new key, then delete the source.
func (c *minioClient) Move(ctx context.Context, bucket, srcKey, dstKey string) error {
	_, err := c.mc.CopyObject(ctx,
		minio.CopyDestOptions{Bucket: bucket, Object: dstKey},
		minio.CopySrcOptions{Bucket: bucket, Object: srcKey})
	if err != nil {
		return wrapErr(err)
	}
	return wrapErr(c.mc.RemoveObject(ctx, bucket, srcKey, minio.RemoveObjectOptions{}))
}

// DeletePrefix removes every object under prefix (recursive folder delete).
func (c *minioClient) DeletePrefix(ctx context.Context, bucket, prefix string) error {
	objCh := make(chan minio.ObjectInfo)
	go func() {
		defer close(objCh)
		for o := range c.mc.ListObjects(ctx, bucket, minio.ListObjectsOptions{Prefix: prefix, Recursive: true}) {
			if o.Err == nil {
				objCh <- o
			}
		}
	}()
	for e := range c.mc.RemoveObjects(ctx, bucket, objCh, minio.RemoveObjectsOptions{}) {
		if e.Err != nil {
			return wrapErr(e.Err)
		}
	}
	// Best-effort removal of the folder marker object itself.
	c.mc.RemoveObject(ctx, bucket, prefix, minio.RemoveObjectOptions{})
	return nil
}

// MovePrefix renames a folder by copying every object from srcPrefix to dstPrefix
// (preserving relative keys) and deleting the originals.
func (c *minioClient) MovePrefix(ctx context.Context, bucket, srcPrefix, dstPrefix string) error {
	for o := range c.mc.ListObjects(ctx, bucket, minio.ListObjectsOptions{Prefix: srcPrefix, Recursive: true}) {
		if o.Err != nil {
			return wrapErr(o.Err)
		}
		dst := dstPrefix + strings.TrimPrefix(o.Key, srcPrefix)
		if _, err := c.mc.CopyObject(ctx,
			minio.CopyDestOptions{Bucket: bucket, Object: dst},
			minio.CopySrcOptions{Bucket: bucket, Object: o.Key}); err != nil {
			return wrapErr(err)
		}
		if err := c.mc.RemoveObject(ctx, bucket, o.Key, minio.RemoveObjectOptions{}); err != nil {
			return wrapErr(err)
		}
	}
	return nil
}
