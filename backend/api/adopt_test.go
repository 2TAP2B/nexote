package api

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"nexote/accounts"
	"nexote/notes"
)

// A server from before accounts: vaults without a space, global collection
// definitions, one journal and the quick-capture Notepad in a vault. The
// first admin must end up with all of it, nothing lost.
func TestFirstAdminAdoptsPreAccountData(t *testing.T) {
	e := newTestEnv(t)
	reg := e.h.Registry
	myvault, err := reg.Create("myvault", "Folder", "")
	if err != nil {
		t.Fatal(err)
	}
	colVault, err := reg.Create("Collections", "Folder", "")
	if err != nil {
		t.Fatal(err)
	}
	if err := reg.SetType(colVault.ID, notes.VaultTypeCollections); err != nil {
		t.Fatal(err)
	}
	legacyCols := filepath.Join(e.home, "collections", "collections.json")
	if err := os.MkdirAll(filepath.Dir(legacyCols), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(legacyCols, []byte(`[{"id":"records","name":"Records","fields":[]}]`), 0o644); err != nil {
		t.Fatal(err)
	}
	legacyJournal, err := notes.NewStore(filepath.Join(e.home, "journal"))
	if err != nil {
		t.Fatal(err)
	}
	day, err := legacyJournal.Daily("2026-02-01")
	if err != nil {
		t.Fatal(err)
	}
	vaultStore, err := reg.Store(myvault.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(vaultStore.Dir, "pic.png"), []byte("png"), 0o644); err != nil {
		t.Fatal(err)
	}
	pad, err := vaultStore.Create(notes.CreateInput{
		Title: "Notepad",
		Body:  "- 09:00 memo ![](/api/vaults/" + myvault.ID + "/images/pic.png)\n",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(vaultStore.Dir, ".bookmarks.json"), []byte(`["`+pad.Meta.ID+`"]`), 0o644); err != nil {
		t.Fatal(err)
	}

	admin, adminTok := e.user("admin", accounts.RoleAdmin)
	if err := e.h.AdoptLegacyData(); err != nil {
		t.Fatalf("adopt: %v", err)
	}

	spaces := e.h.Spaces.ForUser(admin.ID)
	if len(spaces) != 1 {
		t.Fatalf("admin has %d spaces, want 1", len(spaces))
	}
	space := spaces[0]
	vaults, _ := reg.List()
	for _, v := range vaults {
		if v.SpaceID != space.ID {
			t.Errorf("vault %q not adopted (space %q)", v.Name, v.SpaceID)
		}
	}

	if _, err := os.Stat(legacyCols); !os.IsNotExist(err) {
		t.Errorf("legacy collections.json still there: %v", err)
	}
	rec := e.do("GET", "/api/collections?space="+space.ID, adminTok, nil)
	e.expect(rec, http.StatusOK, "space collections")
	if !strings.Contains(rec.Body.String(), `"Records"`) {
		t.Errorf("adopted collections lack Records: %s", rec.Body.String())
	}

	e.expect(e.do("GET", "/api/journal/notes/"+day.Meta.ID, adminTok, nil), http.StatusOK, "admin reads the old journal note")
	if _, err := os.Stat(filepath.Join(e.home, "journal")); !os.IsNotExist(err) {
		t.Errorf("legacy journal dir still there: %v", err)
	}

	home, err := e.h.personalStore(admin.ID, "home")
	if err != nil {
		t.Fatal(err)
	}
	list, _ := home.List()
	var moved *notes.Entry
	for i := range list.Notes {
		if list.Notes[i].Title == "Notepad" {
			moved = &list.Notes[i]
		}
	}
	if moved == nil {
		t.Fatal("Notepad not in the admin's home store")
	}
	doc, err := home.Get(moved.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(doc.Body, "/api/vaults/home/images/pic.png") {
		t.Errorf("Notepad image URL not rewritten: %q", doc.Body)
	}
	e.expect(e.do("GET", "/api/vaults/home/images/pic.png", adminTok, nil), http.StatusOK, "Notepad image")
	if _, err := vaultStore.Get(pad.Meta.ID); err == nil {
		t.Error("Notepad still in the vault")
	}

	if data, err := os.ReadFile(filepath.Join(vaultStore.Dir, ".bookmarks-"+admin.ID+".json")); err != nil {
		t.Errorf("bookmarks not adopted: %v", err)
	} else if !strings.Contains(string(data), pad.Meta.ID) {
		t.Errorf("adopted bookmarks lost their ids: %s", data)
	}

	// Running again (every start does) changes nothing.
	if err := e.h.AdoptLegacyData(); err != nil {
		t.Fatalf("second adopt: %v", err)
	}
	if n := len(e.h.Spaces.List()); n != 1 {
		t.Errorf("second adopt: %d spaces, want 1", n)
	}
}
