package api

import (
	"encoding/json"
	"net/http"
	"testing"

	"nexote/accounts"
)

// collectionItem creates a note in the space's Collections vault, in the
// folder of the collection named folder (where the item editor puts it).
func (e *testEnv) collectionItem(vaultID, token, folder, title string) string {
	e.t.Helper()
	rec := e.do("POST", "/api/vaults/"+vaultID+"/notes", token, map[string]string{"title": title, "path": folder})
	e.expect(rec, http.StatusCreated, "create item "+title)
	var p Payload
	_ = json.Unmarshal(rec.Body.Bytes(), &p)
	return p.ID
}

func TestDeletingACollectionDeletesItsItems(t *testing.T) {
	e := newTestEnv(t)
	alice, tok := e.user("alice", accounts.RoleAdmin)
	space, notesVault := e.space(alice, "Alice")
	base := "/api/collections?space=" + space.ID

	e.expect(e.do("POST", base, tok, map[string]any{"name": "Board games"}), http.StatusCreated, "create collection")
	vault := e.h.collectionsVaultID(space.ID)
	if vault == "" {
		t.Fatal("no Collections vault")
	}
	item := e.collectionItem(vault, tok, "Board games", "Catan")
	other := e.createNote(notesVault, tok, "Unrelated note")

	e.expect(e.do("DELETE", "/api/collections/board-games?space="+space.ID, tok, nil), http.StatusNoContent, "delete collection")
	e.expect(e.do("GET", "/api/vaults/"+vault+"/notes/"+item, tok, nil), http.StatusNotFound, "item after its collection was deleted")
	e.expect(e.do("GET", "/api/vaults/"+notesVault+"/notes/"+other, tok, nil), http.StatusOK, "note outside the collection")

	rec := e.do("GET", base, tok, nil)
	var list struct {
		Collections []struct{ ID string } `json:"collections"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &list)
	for _, c := range list.Collections {
		if c.ID == "board-games" {
			t.Error("deleted collection still listed")
		}
	}
}

func TestBuiltInCollectionsCanOnlyBeHidden(t *testing.T) {
	e := newTestEnv(t)
	alice, tok := e.user("alice", accounts.RoleAdmin)
	space, _ := e.space(alice, "Alice")

	e.expect(e.do("GET", "/api/collections?space="+space.ID, tok, nil), http.StatusOK, "list collections")
	vault := e.h.collectionsVaultID(space.ID)
	item := e.collectionItem(vault, tok, "Vinyls", "Kind of Blue")

	e.expect(e.do("DELETE", "/api/collections/vinyls?space="+space.ID, tok, nil), http.StatusBadRequest, "delete a built-in")
	e.expect(e.do("GET", "/api/vaults/"+vault+"/notes/"+item, tok, nil), http.StatusOK, "built-in's item after the refused delete")
	e.expect(e.do("PATCH", "/api/collections/vinyls/hidden?space="+space.ID, tok, map[string]bool{"hidden": true}), http.StatusOK, "hide a built-in")
}

func TestRenamingACollectionMovesItsItems(t *testing.T) {
	e := newTestEnv(t)
	alice, tok := e.user("alice", accounts.RoleAdmin)
	space, _ := e.space(alice, "Alice")
	base := "/api/collections?space=" + space.ID

	e.expect(e.do("POST", base, tok, map[string]any{"name": "Games"}), http.StatusCreated, "create collection")
	vault := e.h.collectionsVaultID(space.ID)
	item := e.collectionItem(vault, tok, "Games", "Catan")

	e.expect(e.do("PUT", "/api/collections/games?space="+space.ID, tok, map[string]any{"name": "Books"}), http.StatusBadRequest, "rename onto another collection's name")
	e.expect(e.do("PUT", "/api/collections/games?space="+space.ID, tok, map[string]any{"name": "Board games"}), http.StatusOK, "rename")

	rec := e.do("GET", "/api/vaults/"+vault+"/notes/"+item, tok, nil)
	e.expect(rec, http.StatusOK, "item after the rename")
	var p Payload
	_ = json.Unmarshal(rec.Body.Bytes(), &p)
	if p.Path != "Board games" {
		t.Errorf("item path %q, want the renamed folder %q", p.Path, "Board games")
	}

	// A delete after the rename still takes the item along.
	e.expect(e.do("DELETE", "/api/collections/games?space="+space.ID, tok, nil), http.StatusNoContent, "delete renamed collection")
	e.expect(e.do("GET", "/api/vaults/"+vault+"/notes/"+item, tok, nil), http.StatusNotFound, "item after deleting the renamed collection")
}
