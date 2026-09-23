package httpapi

import (
	"net/http"
	"testing"

	"finova/internal/db"
)

func TestVideoIDFromURL(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"https://www.youtube.com/watch?v=dsuJZx24V_A", "dsuJZx24V_A"},
		{"https://m.youtube.com/watchfeature=youtu.be&v=lvuHvXsZPrk", "lvuHvXsZPrk"},
		{"https://youtu.be/ZNGqBDRJgvo?t=3", "ZNGqBDRJgvo"},
		{"https://www.youtube.com/embed/O6Pf-7F06SQ", "O6Pf-7F06SQ"},
		{"https://www.youtube.com/shorts/abcDEF12345", "abcDEF12345"},
		{"https://www.youtube.com/live/abcDEF12345", "abcDEF12345"},
		{"  abcDEF12345  ", "abcDEF12345"},
		{"https://example.com/not-a-video", ""},
		{"terlalu pendek", ""},
		{"", ""},
	}
	for _, item := range cases {
		if got := videoIDFromURL(item.in); got != item.want {
			t.Fatalf("videoIDFromURL(%q)=%q, ingin %q", item.in, got, item.want)
		}
	}
}

func TestTrackCRUDAndOrder(t *testing.T) {
	server := newTestServer(t)

	// Daftar kosong di awal.
	_, listing := server.json(http.MethodGet, "/api/tracks", nil)
	if tracks, ok := listing["tracks"].([]any); !ok || len(tracks) != 0 {
		t.Fatalf("daftar awal harus kosong, dapat %+v", listing)
	}

	add := func(title, url string) map[string]any {
		status, payload := server.json(http.MethodPost, "/api/tracks", map[string]any{
			"title": title, "url": url, "artist": "Lyn - Topic", "thumbnailUrl": "https://example.test/sampul.jpg",
		})
		if status != http.StatusCreated {
			t.Fatalf("tambah %s harus 201, dapat %d %+v", title, status, payload)
		}
		return payload
	}
	first := add("Last Surprise", "https://youtu.be/ZNGqBDRJgvo")
	second := add("Life Will Change", "https://www.youtube.com/watch?v=dsuJZx24V_A")

	_, listing = server.json(http.MethodGet, "/api/tracks", nil)
	tracks, _ := listing["tracks"].([]any)
	if len(tracks) != 2 {
		t.Fatalf("harus dua lagu, dapat %d", len(tracks))
	}
	if db.AsString(tracks[0].(map[string]any)["title"]) != "Last Surprise" {
		t.Fatalf("urutan awal salah: %+v", tracks[0])
	}
	if db.AsString(tracks[1].(map[string]any)["youtube_id"]) != "dsuJZx24V_A" {
		t.Fatalf("youtube_id tidak tersimpan benar: %+v", tracks[1])
	}

	// Tautan sama tidak boleh masuk dua kali.
	if status, payload := server.json(http.MethodPost, "/api/tracks", map[string]any{
		"title": "Duplikat", "url": "ZNGqBDRJgvo",
	}); status != http.StatusConflict {
		t.Fatalf("lagu duplikat harus 409, dapat %d %+v", status, payload)
	}

	// URL tidak dikenal ditolak tanpa menyentuh jaringan.
	if status, payload := server.json(http.MethodPost, "/api/tracks", map[string]any{
		"title": "Bukan YouTube", "url": "https://example.com/x",
	}); status != http.StatusUnprocessableEntity {
		t.Fatalf("URL asing harus 422, dapat %d %+v", status, payload)
	}

	// Urutan dapat disimpan ulang.
	orderPayload := map[string]any{"ids": []any{db.AsInt(second["id"]), db.AsInt(first["id"])}}
	if status, payload := server.json(http.MethodPut, "/api/tracks/order", orderPayload); status != http.StatusOK {
		t.Fatalf("simpan urutan harus 200, dapat %d %+v", status, payload)
	}
	_, listing = server.json(http.MethodGet, "/api/tracks", nil)
	tracks, _ = listing["tracks"].([]any)
	if db.AsString(tracks[0].(map[string]any)["title"]) != "Life Will Change" {
		t.Fatalf("urutan tidak berubah: %+v", tracks)
	}

	// Hapus satu per satu, dan lagu yang sudah hilang memberi 404.
	targetID := db.AsInt(tracks[0].(map[string]any)["id"])
	if status, payload := server.json(http.MethodDelete, "/api/tracks/"+itoa(targetID), nil); status != http.StatusOK {
		t.Fatalf("hapus harus 200, dapat %d %+v", status, payload)
	}
	if status, _ := server.json(http.MethodDelete, "/api/tracks/"+itoa(targetID), nil); status != http.StatusNotFound {
		t.Fatalf("hapus ganda harus 404, dapat %d", status)
	}
	_, listing = server.json(http.MethodGet, "/api/tracks", nil)
	if tracks, _ := listing["tracks"].([]any); len(tracks) != 1 {
		t.Fatalf("sisa satu lagu, dapat %d", len(tracks))
	}
}

func itoa(value int64) string {
	return db.AsString(value)
}
