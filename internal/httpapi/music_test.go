package httpapi

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// Pustaka musik: lagu lokal disimpan sebagai berkas, tautan YouTube disimpan
// sebagai tautan. Tidak ada audio YouTube yang masuk ke disk pada pengujian ini.

func TestVideoIDFromURL(t *testing.T) {
	cases := map[string]string{
		"https://www.youtube.com/watch?v=dsuJZx24V_A":                "dsuJZx24V_A",
		"https://m.youtube.com/watch?feature=youtu.be&v=lvuHvXsZPrk": "lvuHvXsZPrk",
		"https://youtu.be/ZNGqBDRJgvo?t=12":                          "ZNGqBDRJgvo",
		"https://www.youtube.com/shorts/abcDEF12345":                 "abcDEF12345",
		"https://www.youtube.com/embed/O6Pf-7F06SQ":                  "O6Pf-7F06SQ",
		"  abcDEF12345  ":                 "abcDEF12345",
		"https://example.com/watch?v=abc": "",
		"pendek":                          "",
		"":                                "",
	}
	for input, want := range cases {
		if got := videoIDFromURL(input); got != want {
			t.Errorf("videoIDFromURL(%q) = %q, mau %q", input, got, want)
		}
	}
}

func TestCleanTrackTitle(t *testing.T) {
	cases := map[string]string{
		"lagu_keren.mp3":       "lagu keren",
		"Album - Trek 01.flac": "Album Trek 01",
		"tanpa-ekstensi":       "tanpa ekstensi",
	}
	for input, want := range cases {
		if got := cleanTrackTitle(input); got != want {
			t.Errorf("cleanTrackTitle(%q) = %q, mau %q", input, got, want)
		}
	}
	// Nama yang habis terpotong (hanya ekstensi) jatuh ke judul bawaan.
	if got := cleanTrackTitle(".mp3"); got != "Audio" {
		t.Errorf("cleanTrackTitle(.mp3) = %q, mau Audio", got)
	}
}

func TestSafeExtensionDanStoredName(t *testing.T) {
	if got := safeExtension("lagu.flac", ".mp3"); got != ".flac" {
		t.Errorf("safeExtension flac = %q", got)
	}
	if got := safeExtension("video.mp4", ".wav"); got != ".wav" {
		t.Errorf("safeExtension fallback = %q", got)
	}
	if got := storedFileName(7, "lagu.mp3", ".mp3"); got != "track-7.mp3" {
		t.Errorf("storedFileName = %q", got)
	}
}

// uploadAudio membangun permintaan multipart berisi satu berkas audio palsu.
func uploadAudio(t *testing.T, base, name string, content []byte) (int, map[string]any) {
	t.Helper()
	var buffer bytes.Buffer
	writer := multipart.NewWriter(&buffer)
	part, err := writer.CreateFormFile("file", name)
	if err != nil {
		t.Fatalf("buat form file: %v", err)
	}
	if _, err := part.Write(content); err != nil {
		t.Fatalf("tulis form file: %v", err)
	}
	_ = writer.WriteField("duration", "180")
	if err := writer.Close(); err != nil {
		t.Fatalf("tutup writer: %v", err)
	}

	request, err := http.NewRequest(http.MethodPost, base+"/api/music/local", &buffer)
	if err != nil {
		t.Fatalf("buat permintaan: %v", err)
	}
	request.Header.Set("Content-Type", writer.FormDataContentType())
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("unggah gagal: %v", err)
	}
	defer func() { _ = response.Body.Close() }()
	raw, _ := io.ReadAll(response.Body)
	payload := map[string]any{}
	if len(bytes.TrimSpace(raw)) > 0 {
		_ = json.Unmarshal(raw, &payload)
	}
	return response.StatusCode, payload
}

func TestMusicLocalUploadDanStream(t *testing.T) {
	server := newTestServer(t)

	// Audio palsu: isinya tidak penting, yang diuji alur simpan + alir.
	content := []byte("ID3 ini-isi-audio-uji")
	status, payload := uploadAudio(t, server.base, "Musik Malam.flac", content)
	if status != http.StatusCreated {
		t.Fatalf("unggah status = %d, body = %v", status, payload)
	}
	track, _ := payload["track"].(map[string]any)
	if track == nil {
		t.Fatal("respons unggah tanpa track")
	}
	if track["kind"] != "LOCAL" {
		t.Errorf("kind = %v, mau LOCAL", track["kind"])
	}
	if track["title"] != "Musik Malam" {
		t.Errorf("title = %v, mau dari nama berkas", track["title"])
	}
	audioURL, _ := track["audioUrl"].(string)
	if audioURL == "" {
		t.Fatal("track lokal tanpa audioUrl")
	}

	// Berkas benar-benar ada di folder musik milik folder data.
	dir := filepath.Join(server.cfg.DataDir(), "music")
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("folder musik tidak dibuat: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("isi folder musik = %d berkas, mau 1", len(entries))
	}
	stored, err := os.ReadFile(filepath.Join(dir, entries[0].Name()))
	if err != nil {
		t.Fatalf("berkas audio tidak dapat dibaca: %v", err)
	}
	if !bytes.Equal(stored, content) {
		t.Errorf("isi berkas tersimpan berbeda dari yang diunggah")
	}

	// Rute media mengalirkan berkas dengan tipe audio yang benar.
	response, err := http.Get(server.base + audioURL)
	if err != nil {
		t.Fatalf("GET media gagal: %v", err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("GET media status = %d", response.StatusCode)
	}
	if contentType := response.Header.Get("Content-Type"); !strings.HasPrefix(contentType, "audio/") {
		t.Errorf("Content-Type media = %q", contentType)
	}
	streamed, _ := io.ReadAll(response.Body)
	if !bytes.Equal(streamed, content) {
		t.Errorf("isi media berbeda dari berkas yang disimpan")
	}

	// Daftar memuat lagu yang tersimpan.
	status, list := server.json(http.MethodGet, "/api/music", nil)
	if status != http.StatusOK {
		t.Fatalf("GET /api/music status = %d", status)
	}
	tracks, _ := list["tracks"].([]any)
	if len(tracks) != 1 {
		t.Fatalf("jumlah lagu = %d, mau 1", len(tracks))
	}

	// Menghapus lagu membuang baris DAN berkas fisiknya.
	id := int64(track["id"].(float64))
	status, _ = server.json(http.MethodDelete, "/api/music/"+itoa(id), nil)
	if status != http.StatusOK {
		t.Fatalf("DELETE status = %d", status)
	}
	remaining, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("folder musik hilang: %v", err)
	}
	if len(remaining) != 0 {
		t.Errorf("berkas audio masih tersisa setelah dihapus: %d", len(remaining))
	}
	status, _ = server.json(http.MethodGet, "/api/music", nil)
	if status != http.StatusOK {
		t.Fatalf("GET setelah hapus status = %d", status)
	}
}

func TestMusicLocalMenolakFormatBukanAudio(t *testing.T) {
	server := newTestServer(t)
	status, payload := uploadAudio(t, server.base, "laporan.xlsx", []byte("bukan audio"))
	if status != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, mau 422; body = %v", status, payload)
	}
	if !strings.Contains(strings.ToLower(dbMessage(payload)), "format") {
		t.Errorf("pesan galat tidak menyebut format: %v", payload)
	}
}

func TestMusicYouTubeHanyaSimpanTautan(t *testing.T) {
	server := newTestServer(t)

	// Judul dan penyanyi diisi langsung supaya tidak bergantung jaringan (oEmbed).
	status, payload := server.json(http.MethodPost, "/api/music/youtube", map[string]any{
		"url":    "https://youtu.be/dsuJZx24V_A",
		"title":  "Lagu Uji",
		"artist": "Kanal Resmi",
	})
	if status != http.StatusCreated {
		t.Fatalf("simpan tautan status = %d, body = %v", status, payload)
	}
	track, _ := payload["track"].(map[string]any)
	if track == nil {
		t.Fatal("respons tanpa track")
	}
	if track["kind"] != "YOUTUBE" {
		t.Errorf("kind = %v, mau YOUTUBE", track["kind"])
	}
	if track["youtubeId"] != "dsuJZx24V_A" {
		t.Errorf("youtubeId = %v", track["youtubeId"])
	}
	// Tautan YouTube TIDAK punya berkas media: audio tidak disalin ke disk.
	if _, has := track["audioUrl"]; has {
		t.Error("tautan YouTube tidak semestinya punya audioUrl")
	}
	dir := filepath.Join(server.cfg.DataDir(), "music")
	if entries, err := os.ReadDir(dir); err == nil && len(entries) > 0 {
		t.Errorf("folder musik berisi %d berkas padahal hanya tautan YouTube", len(entries))
	}

	// Menyalin rute berkas untuk lagu tautan harus ditolak.
	id := int64(track["id"].(float64))
	status, _ = server.json(http.MethodGet, "/api/music/"+itoa(id)+"/media", nil)
	if status != http.StatusNotFound {
		t.Errorf("GET media untuk tautan YouTube status = %d, mau 404", status)
	}

	// Tautan ganda ditolak sebagai konflik.
	status, _ = server.json(http.MethodPost, "/api/music/youtube", map[string]any{
		"url": "https://www.youtube.com/watch?v=dsuJZx24V_A", "title": "Duplikat", "artist": "X",
	})
	if status != http.StatusConflict {
		t.Errorf("tautan duplikat status = %d, mau 409", status)
	}
}

func TestMusicUrutanPustaka(t *testing.T) {
	server := newTestServer(t)
	first := server.createLocalTrack(t, "satu.mp3", []byte("satu"))
	second := server.createLocalTrack(t, "dua.mp3", []byte("dua"))

	status, _ := server.json(http.MethodPut, "/api/music/order", map[string]any{
		"ids": []any{second, first},
	})
	if status != http.StatusOK {
		t.Fatalf("PUT order status = %d", status)
	}
	_, list := server.json(http.MethodGet, "/api/music", nil)
	tracks, _ := list["tracks"].([]any)
	if len(tracks) != 2 {
		t.Fatalf("jumlah lagu = %d", len(tracks))
	}
	head, _ := tracks[0].(map[string]any)
	if int64(head["id"].(float64)) != second {
		t.Errorf("lagu pertama setelah diurutkan id = %v, mau %d", head["id"], second)
	}
}

// createLocalTrack mengunggah satu berkas audio dan mengembalikan id-nya.
func (s *testServer) createLocalTrack(t *testing.T, name string, content []byte) int64 {
	t.Helper()
	status, payload := uploadAudio(t, s.base, name, content)
	if status != http.StatusCreated {
		t.Fatalf("unggah %s status = %d (%v)", name, status, payload)
	}
	track, _ := payload["track"].(map[string]any)
	return int64(track["id"].(float64))
}

func dbMessage(payload map[string]any) string {
	if text, ok := payload["message"].(string); ok {
		return text
	}
	return ""
}

func itoa(value int64) string { return strconv.FormatInt(value, 10) }
