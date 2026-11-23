package notes

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func fieldLabels(c CollectionMeta) map[string]CollectionField {
	byLabel := map[string]CollectionField{}
	for _, f := range c.Fields {
		byLabel[f.Label] = f
	}
	return byLabel
}

func ensureFrom(t *testing.T, seed []CollectionMeta) map[string]CollectionMeta {
	t.Helper()
	dir := t.TempDir()
	if seed != nil {
		data, _ := json.Marshal(seed)
		if err := os.WriteFile(filepath.Join(dir, "collections.json"), data, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	r, err := NewCollectionRegistry(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := r.EnsureBuiltIns(); err != nil {
		t.Fatal(err)
	}
	cols, err := r.List()
	if err != nil {
		t.Fatal(err)
	}
	byID := map[string]CollectionMeta{}
	for _, c := range cols {
		byID[c.ID] = c
	}
	return byID
}

func TestBuiltInsHaveCollectionAndWantlistSwitches(t *testing.T) {
	cols := ensureFrom(t, nil)
	for _, id := range []string{"vinyls", "books"} {
		labels := fieldLabels(cols[id])
		for key, label := range map[string]string{"owned": "In my collection", "wantlist": "On my wantlist"} {
			f, ok := labels[label]
			if !ok || f.Key != key || f.Type != FieldBoolean {
				t.Errorf("%s: field %q = %+v, want a Yes/No field with key %q", id, label, f, key)
			}
		}
	}
}

func TestEnsureBuiltInsUpgradesExistingCollections(t *testing.T) {
	published := CollectionField{Key: "field7", Label: "Published", Type: FieldBoolean}
	cols := ensureFrom(t, []CollectionMeta{
		{ID: "vinyls", Name: "Vinyls", BuiltIn: true, Fields: []CollectionField{
			{Key: "artist", Label: "Artist", Type: FieldText},
			published,
			{Key: "pressing", Label: "Pressing", Type: FieldText},
			// The early record feature's switch: its values must stay with it.
			{Key: "wantlist", Label: "Wantlist", Type: FieldBoolean},
		}},
		{ID: "books", Name: "Books", BuiltIn: true, Fields: []CollectionField{published}},
		{ID: "comics", Name: "Comics", Fields: []CollectionField{published}},
	})

	vinyls := fieldLabels(cols["vinyls"])
	if _, ok := vinyls["Published"]; ok {
		t.Error("Vinyls still has its Yes/No Published field")
	}
	if _, ok := vinyls["Pressing"]; !ok {
		t.Error("a field the user added to Vinyls was removed")
	}
	if f := vinyls["In my collection"]; f.Key != "owned" {
		t.Error("Vinyls didn't get In my collection")
	}
	wantlists := 0
	for _, f := range cols["vinyls"].Fields {
		if f.Key == "wantlist" {
			wantlists++
		}
	}
	if wantlists != 1 {
		t.Errorf("Vinyls has %d wantlist fields, want the existing one kept", wantlists)
	}

	// Only Vinyls retire it: elsewhere "Published" may mean something.
	if _, ok := fieldLabels(cols["books"])["Published"]; !ok {
		t.Error("Books lost a Published field")
	}
	if _, ok := fieldLabels(cols["comics"])["Published"]; !ok {
		t.Error("a user's collection lost a Published field")
	}
}
