package garage

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestListAdminTokens(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v2/ListAdminTokens" {
			t.Errorf("path=%q", r.URL.Path)
		}
		w.Write([]byte(`[{"id":null,"created":null,"name":"cfg","expiration":null,"expired":false,"scope":["*"]},{"id":"tok1","created":"x","name":"app","expiration":null,"expired":false,"scope":["Metrics"]}]`))
	}))
	defer srv.Close()
	got, err := New(srv.URL, "t").ListAdminTokens()
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].ID != nil || got[1].ID == nil || *got[1].ID != "tok1" {
		t.Errorf("got %+v", got)
	}
}

func TestGetCurrentAdminTokenInfo(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v2/GetCurrentAdminTokenInfo" {
			t.Errorf("path=%q", r.URL.Path)
		}
		w.Write([]byte(`{"id":null,"created":null,"name":"cfg","expiration":null,"expired":false,"scope":["*"]}`))
	}))
	defer srv.Close()
	got, err := New(srv.URL, "t").GetCurrentAdminTokenInfo()
	if err != nil {
		t.Fatal(err)
	}
	if got.Name != "cfg" || len(got.Scope) != 1 || got.Scope[0] != "*" {
		t.Errorf("got %+v", got)
	}
}

func TestCreateAdminTokenReturnsSecret(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v2/CreateAdminToken" || r.Method != http.MethodPost {
			t.Errorf("path=%q method=%q", r.URL.Path, r.Method)
		}
		var body AdminTokenRequest
		b, _ := io.ReadAll(r.Body)
		json.Unmarshal(b, &body)
		if body.Name != "app" || len(body.Scope) != 1 || body.Scope[0] != "*" {
			t.Errorf("body=%+v", body)
		}
		w.Write([]byte(`{"id":"tok9","created":"x","name":"app","expiration":null,"expired":false,"scope":["*"],"secretToken":"SECRET-TOKEN-ONCE"}`))
	}))
	defer srv.Close()
	nev := true
	got, err := New(srv.URL, "t").CreateAdminToken(AdminTokenRequest{Name: "app", Scope: []string{"*"}, NeverExpires: &nev})
	if err != nil {
		t.Fatal(err)
	}
	if got.SecretToken == nil || *got.SecretToken != "SECRET-TOKEN-ONCE" || got.ID == nil || *got.ID != "tok9" {
		t.Errorf("got %+v", got)
	}
}

func TestUpdateAndDeleteAdminToken(t *testing.T) {
	var paths []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path+"?"+r.URL.RawQuery)
		w.Write([]byte(`{"id":"tok1","created":"x","name":"renamed","expiration":null,"expired":false,"scope":["*"]}`))
	}))
	defer srv.Close()
	c := New(srv.URL, "t")
	name := "renamed"
	nev := true
	if _, err := c.UpdateAdminToken("tok1", AdminTokenRequest{Name: name, Scope: []string{"*"}, NeverExpires: &nev}); err != nil {
		t.Fatal(err)
	}
	if err := c.DeleteAdminToken("tok1"); err != nil {
		t.Fatal(err)
	}
	if paths[0] != "/v2/UpdateAdminToken?id=tok1" || paths[1] != "/v2/DeleteAdminToken?id=tok1" {
		t.Errorf("paths=%v", paths)
	}
}
