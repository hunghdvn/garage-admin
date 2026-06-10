package s3

import "testing"

func TestParseEndpoint(t *testing.T) {
	cases := []struct {
		in     string
		host   string
		secure bool
	}{
		{"http://192.168.101.8:3900", "192.168.101.8:3900", false},
		{"https://s3.example.com", "s3.example.com", true},
		{"192.168.1.5:3900", "192.168.1.5:3900", false},
	}
	for _, c := range cases {
		host, secure, err := parseEndpoint(c.in)
		if err != nil {
			t.Fatalf("%s: %v", c.in, err)
		}
		if host != c.host || secure != c.secure {
			t.Errorf("%s -> host=%q secure=%v; want %q %v", c.in, host, secure, c.host, c.secure)
		}
	}
}

func TestEntryFromKey(t *testing.T) {
	// directory marker under prefix "docs/"
	d := entryFromKey("docs/img/", "docs/", 0, "")
	if !d.IsDir || d.Name != "img" {
		t.Errorf("dir entry = %+v", d)
	}
	// file under prefix "docs/"
	f := entryFromKey("docs/readme.txt", "docs/", 12, "2026-01-01T00:00:00Z")
	if f.IsDir || f.Name != "readme.txt" || f.Size != 12 {
		t.Errorf("file entry = %+v", f)
	}
	// file at root (empty prefix)
	r := entryFromKey("top.bin", "", 5, "")
	if r.IsDir || r.Name != "top.bin" {
		t.Errorf("root entry = %+v", r)
	}
}
