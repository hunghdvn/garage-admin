package garage

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCreateKeyWithExpiration(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		b, _ := io.ReadAll(r.Body)
		json.Unmarshal(b, &body)
		if body["name"] != "k" || body["expiration"] != "2030-01-01T00:00:00Z" {
			t.Errorf("body=%v", body)
		}
		w.Write([]byte(`{"accessKeyId":"GK9","secretAccessKey":"S","created":"x","name":"k","expiration":"2030-01-01T00:00:00Z","expired":false,"permissions":{"createBucket":false},"buckets":[]}`))
	}))
	defer srv.Close()
	exp := "2030-01-01T00:00:00Z"
	if _, err := New(srv.URL, "t").CreateKey(KeyCreateRequest{Name: "k", Expiration: &exp}); err != nil {
		t.Fatal(err)
	}
}

func TestUpdateKeyExpiration(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		b, _ := io.ReadAll(r.Body)
		json.Unmarshal(b, &body)
		if body["neverExpires"] != true {
			t.Errorf("body=%v", body)
		}
		w.Write([]byte(`{"accessKeyId":"GK1","created":"x","name":"k","expiration":null,"expired":false,"permissions":{"createBucket":false},"buckets":[]}`))
	}))
	defer srv.Close()
	if _, err := New(srv.URL, "t").UpdateKey("GK1", UpdateKeyRequest{NeverExpires: true}); err != nil {
		t.Fatal(err)
	}
}
