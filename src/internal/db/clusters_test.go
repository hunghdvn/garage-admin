package db

import "testing"

func sampleCluster() *Cluster {
	return &Cluster{
		Name:           "local",
		AdminEndpoint:  "http://192.168.101.8:3903",
		AdminTokenEnc:  "enc-token",
		S3Endpoint:     "http://192.168.101.8:3900",
		S3Region:       "garage",
		S3AccessKey:    "GKxxxx",
		S3SecretKeyEnc: "enc-secret",
		IsDefault:      true,
	}
}

func TestCreateAndGetCluster(t *testing.T) {
	d := newTestDB(t)
	c, err := d.CreateCluster(sampleCluster())
	if err != nil {
		t.Fatal(err)
	}
	if c.ID == 0 {
		t.Fatal("expected id")
	}
	got, err := d.GetCluster(c.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.AdminEndpoint != "http://192.168.101.8:3903" || got.AdminTokenEnc != "enc-token" {
		t.Errorf("unexpected cluster: %+v", got)
	}
}

func TestListClustersAndDefault(t *testing.T) {
	d := newTestDB(t)
	d.CreateCluster(sampleCluster())
	second := sampleCluster()
	second.Name = "remote"
	second.IsDefault = false
	d.CreateCluster(second)

	list, err := d.ListClusters()
	if err != nil || len(list) != 2 {
		t.Fatalf("ListClusters len=%d err=%v", len(list), err)
	}
	def, err := d.GetDefaultCluster()
	if err != nil {
		t.Fatal(err)
	}
	if def.Name != "local" {
		t.Errorf("default = %q, want local", def.Name)
	}
}

func TestUpdateAndDeleteCluster(t *testing.T) {
	d := newTestDB(t)
	c, _ := d.CreateCluster(sampleCluster())
	c.Name = "renamed"
	if err := d.UpdateCluster(c); err != nil {
		t.Fatal(err)
	}
	got, _ := d.GetCluster(c.ID)
	if got.Name != "renamed" {
		t.Errorf("name = %q, want renamed", got.Name)
	}
	if err := d.DeleteCluster(c.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := d.GetCluster(c.ID); err == nil {
		t.Error("expected cluster gone")
	}
}
