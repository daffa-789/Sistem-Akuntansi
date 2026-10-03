package httpapi

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"finova/internal/db"
)

// Pustaka musik Finova. Dua jenis lagu disimpan di tabel music_tracks:
//
//	kind='LOCAL'   berkas audio milik pengguna sendiri yang diimpor dari disk.
//	               Isinya disalin ke <DataDir>/music supaya tetap ada setelah
//	               aplikasi ditutup, lalu dialirkan kembali lewat rute /media.
//	kind='YOUTUBE' hanya TAUTAN video resmi. Audio YouTube tidak pernah disalin
//	               atau disimpan ke disk: pemutarannya lewat penyematan IFrame
//	               resmi di peramban, jadi server ini tidak menyentuh medianya.
//
// Dengan begitu "lagu yang sudah diunduh" tetap tersimpan lintas-sesi tanpa
// melanggar Ketentuan Layanan YouTube.

// maxAudioSize batas satu berkas audio impor (100 MB) — satu album utuh pun muat,
// tetapi tetap ada pagar agar folder data tidak diledakkan berkas raksasa.
const maxAudioSize = 100 * 1024 * 1024

// musicDirName subfolder di dalam folder data aplikasi.
const musicDirName = "music"

// youtubeID mencocokkan 11 karakter ID video YouTube.
var youtubeID = regexp.MustCompile(`^[A-Za-z0-9_-]{11}$`)

// videoIDFromURL menerima URL watch/short/embed/youtu.be atau ID polos.
func videoIDFromURL(value string) string {
	text := strings.TrimSpace(value)
	if youtubeID.MatchString(text) {
		return text
	}
	patterns := []*regexp.Regexp{
		regexp.MustCompile(`[?&]v=([A-Za-z0-9_-]{11})`),
		regexp.MustCompile(`youtu\.be/([A-Za-z0-9_-]{11})`),
		regexp.MustCompile(`/embed/([A-Za-z0-9_-]{11})`),
		regexp.MustCompile(`/shorts/([A-Za-z0-9_-]{11})`),
		regexp.MustCompile(`/live/([A-Za-z0-9_-]{11})`),
	}
	for _, pattern := range patterns {
		if match := pattern.FindStringSubmatch(text); match != nil {
			return match[1]
		}
	}
	return ""
}

// oEmbedResult bentuk respons oEmbed YouTube untuk mengisi judul secara otomatis.
type oEmbedResult struct {
	Title        string `json:"title"`
	AuthorName   string `json:"author_name"`
	ThumbnailURL string `json:"thumbnail_url"`
}

// lookupVideo meminta metadata publik video lewat endpoint oEmbed resmi YouTube.
// Bila jaringan tidak tersedia (mis. pemasangan luring), fungsi mengembalikan false
// tanpa error agar pengguna tetap bisa menyimpan tautan dengan judul sendiri.
func lookupVideo(id string) (oEmbedResult, bool) {
	client := &http.Client{Timeout: 4 * time.Second}
	endpoint := fmt.Sprintf("https://www.youtube.com/oembed?format=json&url=https%%3A%%2F%%2Fwww.youtube.com%%2Fwatch%%3Fv%%3D%s", id)
	response, err := client.Get(endpoint)
	if err != nil {
		return oEmbedResult{}, false
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		return oEmbedResult{}, false
	}
	var payload oEmbedResult
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return oEmbedResult{}, false
	}
	return payload, true
}

func thumbnailFor(id string) string {
	return fmt.Sprintf("https://i.ytimg.com/vi/%s/hqdefault.jpg", id)
}

// musicDir folder penyimpanan berkas audio impor; dibuat bila belum ada.
func (s *Server) musicDir() (string, error) {
	dir := filepath.Join(s.cfg.DataDir(), musicDirName)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("gagal menyiapkan folder musik: %w", err)
	}
	return dir, nil
}

// audioExtension menerima ekstensi berkas audio yang didukung. Daftar ini sama
// dengan yang diumumkan di frontend supaya pengguna tidak mengunggah format
// yang kemudian ditolak.
var audioExtensions = map[string]bool{
	".mp3": true, ".m4a": true, ".aac": true, ".ogg": true, ".oga": true,
	".opus": true, ".wav": true, ".flac": true, ".weba": true,
}

// safeExtension mengambil ekstensi yang aman dari nama berkas unggahan.
func safeExtension(name, fallback string) string {
	ext := strings.ToLower(filepath.Ext(name))
	if audioExtensions[ext] {
		return ext
	}
	if audioExtensions[fallback] {
		return fallback
	}
	return ".bin"
}

// storedFileName nama berkas internal berbasis ID baris: tidak memakai nama asli
// pengguna agar tidak ada karakter aneh atau tabrakan nama di disk.
func storedFileName(id int64, name, fallbackExt string) string {
	return fmt.Sprintf("track-%d%s", id, safeExtension(name, fallbackExt))
}

// trackSelect daftar kolom publik (tanpa klausa FROM) supaya pemanggil bebas
// menambahkan WHERE-nya. Nama berkas internal sengaja tidak diikutkan: frontend
// memutar lagu lokal lewat URL /api/music/{id}/media.
const trackSelect = `SELECT id, kind, title, artist, youtube_id, thumbnail_url, ` +
	`file_bytes, duration, position, created_at FROM music_tracks`

// trackPayload mengubah baris database menjadi bentuk JSON untuk frontend.
func trackPayload(row db.Row) map[string]any {
	id := db.AsInt(row["id"])
	kind := db.AsString(row["kind"])
	payload := map[string]any{
		"id":       id,
		"kind":     kind,
		"title":    db.AsString(row["title"]),
		"artist":   db.AsString(row["artist"]),
		"position": db.AsInt(row["position"]),
		"addedAt":  db.AsString(row["created_at"]),
	}
	if kind == "LOCAL" {
		payload["audioUrl"] = fmt.Sprintf("/api/music/%d/media", id)
		payload["sizeBytes"] = db.AsInt(row["file_bytes"])
		payload["duration"] = db.AsFloat(row["duration"])
		return payload
	}
	videoID := db.AsString(row["youtube_id"])
	thumbnail := db.AsString(row["thumbnail_url"])
	if thumbnail == "" && videoID != "" {
		thumbnail = thumbnailFor(videoID)
	}
	payload["youtubeId"] = videoID
	payload["thumbnail"] = thumbnail
	return payload
}

// listTracks GET /api/music — seluruh pustaka, urut posisi lalu id.
func (s *Server) listTracks(w http.ResponseWriter, _ *http.Request) error {
	rows, err := s.database.Select(
		trackSelect+" WHERE company_id = ? ORDER BY position, id", s.companyID())
	if err != nil {
		return err
	}
	tracks := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		tracks = append(tracks, trackPayload(row))
	}
	return writeJSON(w, http.StatusOK, map[string]any{"tracks": tracks})
}

// nextMusicPosition posisi berikutnya di ujung daftar.
func (s *Server) nextMusicPosition() int64 {
	row, err := s.database.SelectOne(
		"SELECT COALESCE(MAX(position), 0) AS position FROM music_tracks WHERE company_id = ?", s.companyID())
	if err != nil || row == nil {
		return 1
	}
	return db.AsInt(row["position"]) + 1
}

// postYouTubeTrack POST /api/music/youtube { url | youtubeId, title?, artist? }
// hanya menyimpan TAUTAN; tidak ada audio yang diunduh dari YouTube.
func (s *Server) postYouTubeTrack(w http.ResponseWriter, r *http.Request) error {
	body, err := readBody(r)
	if err != nil {
		return err
	}
	id := videoIDFromURL(bodyText(body, "url", "youtubeId", "link"))
	if id == "" {
		return fail(http.StatusUnprocessableEntity,
			"Tautan YouTube tidak dikenali. Tempel URL video atau 11 karakter ID-nya.")
	}

	title := bodyText(body, "title")
	artist := bodyText(body, "artist")
	thumbnail := bodyText(body, "thumbnailUrl")
	if title == "" || artist == "" || thumbnail == "" {
		if meta, ok := lookupVideo(id); ok {
			if title == "" {
				title = meta.Title
			}
			if artist == "" {
				artist = meta.AuthorName
			}
			if thumbnail == "" {
				thumbnail = meta.ThumbnailURL
			}
		}
	}
	if title == "" {
		return fail(http.StatusUnprocessableEntity,
			"Judul tidak dapat diambil otomatis (jaringan terbatas). Isi judul sendiri lalu simpan.")
	}
	if thumbnail == "" {
		thumbnail = thumbnailFor(id)
	}

	created, err := s.database.Exec(
		`INSERT INTO music_tracks (company_id, kind, title, artist, youtube_id, thumbnail_url, added_by, position)
		 VALUES (?, 'YOUTUBE', ?, ?, ?, ?, ?, ?)`,
		s.companyID(), title, artist, id, thumbnail, s.operatorID, s.nextMusicPosition())
	if err != nil {
		if db.IsUniqueViolation(err) {
			return fail(http.StatusConflict, "Video ini sudah ada di pustaka musik.")
		}
		return err
	}
	row, err := s.database.SelectOne(trackSelect+" WHERE id = ?", created.InsertID)
	if err != nil || row == nil {
		return fail(http.StatusInternalServerError, "Lagu tersimpan tetapi gagal dibaca kembali.")
	}
	return writeJSON(w, http.StatusCreated, map[string]any{"track": trackPayload(row)})
}

// postLocalTrack POST /api/music/local (multipart: file, title?, artist?, duration?)
// menyalin berkas audio MILIK PENGGUNA ke folder data aplikasi agar tersimpan
// permanen. Server tidak pernah mengunduh audio dari internet.
func (s *Server) postLocalTrack(w http.ResponseWriter, r *http.Request) error {
	if err := r.ParseMultipartForm(maxAudioSize); err != nil {
		return fail(http.StatusUnprocessableEntity, "Berkas audio tidak dapat dibaca. Coba lagi.")
	}
	defer func() {
		if r.MultipartForm != nil {
			_ = r.MultipartForm.RemoveAll()
		}
	}()

	part, header, err := r.FormFile("file")
	if err != nil {
		return fail(http.StatusUnprocessableEntity, "Pilih berkas audio terlebih dahulu.")
	}
	defer func() { _ = part.Close() }()

	if header.Size > maxAudioSize {
		return fail(http.StatusRequestEntityTooLarge,
			fmt.Sprintf("Ukuran berkas melebihi %d MB.", maxAudioSize/1024/1024))
	}
	if !audioExtensions[strings.ToLower(filepath.Ext(header.Filename))] {
		return fail(http.StatusUnprocessableEntity,
			"Format berkas belum didukung. Pakai MP3, M4A, AAC, OGG, OPUS, WAV, atau FLAC.")
	}

	// Judul bawaan diambil dari nama berkas yang sudah dibersihkan.
	title := strings.TrimSpace(r.FormValue("title"))
	if title == "" {
		title = cleanTrackTitle(header.Filename)
	}
	artist := strings.TrimSpace(r.FormValue("artist"))
	if artist == "" {
		artist = "Berkas lokal"
	}
	duration := db.AsFloat(strings.TrimSpace(r.FormValue("duration")))

	created, err := s.database.Exec(
		`INSERT INTO music_tracks (company_id, kind, title, artist, file_bytes, duration, added_by, position)
		 VALUES (?, 'LOCAL', ?, ?, ?, ?, ?, ?)`,
		s.companyID(), title, artist, header.Size, duration, s.operatorID, s.nextMusicPosition())
	if err != nil {
		return err
	}

	if err := s.storeAudioFile(created.InsertID, header.Filename, part); err != nil {
		// Berkas gagal disalin: jangan tinggalkan baris yatim di pustaka.
		_, _ = s.database.Exec("DELETE FROM music_tracks WHERE id = ?", created.InsertID)
		return err
	}

	row, err := s.database.SelectOne(trackSelect+" WHERE id = ?", created.InsertID)
	if err != nil || row == nil {
		return fail(http.StatusInternalServerError, "Lagu tersimpan tetapi gagal dibaca kembali.")
	}
	return writeJSON(w, http.StatusCreated, map[string]any{"track": trackPayload(row)})
}

// storeAudioFile menulis isi unggahan ke disk di dalam folder musik.
func (s *Server) storeAudioFile(id int64, originalName string, source io.Reader) error {
	dir, err := s.musicDir()
	if err != nil {
		return err
	}
	destination := filepath.Join(dir, storedFileName(id, originalName, ".mp3"))
	file, err := os.OpenFile(destination, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)
	if err != nil {
		return fmt.Errorf("berkas audio tidak dapat disimpan: %w", err)
	}
	written, copyErr := io.Copy(file, io.LimitReader(source, maxAudioSize+1))
	closeErr := file.Close()
	if copyErr != nil {
		_ = os.Remove(destination)
		return fmt.Errorf("berkas audio gagal ditulis: %w", copyErr)
	}
	if closeErr != nil {
		_ = os.Remove(destination)
		return closeErr
	}
	if written > maxAudioSize {
		_ = os.Remove(destination)
		return fail(http.StatusRequestEntityTooLarge,
			fmt.Sprintf("Ukuran berkas melebihi %d MB.", maxAudioSize/1024/1024))
	}
	_, err = s.database.Exec("UPDATE music_tracks SET file_name = ?, file_bytes = ? WHERE id = ?",
		filepath.Base(destination), written, id)
	return err
}

// cleanTrackTitle mengubah nama berkas menjadi judul yang enak dibaca:
// buang ekstensi, ganti pemisah dengan spasi, rapikan spasi ganda.
func cleanTrackTitle(name string) string {
	base := filepath.Base(name)
	base = strings.TrimSuffix(base, filepath.Ext(base))
	base = strings.NewReplacer("_", " ", "-", " ").Replace(base)
	base = strings.Join(strings.Fields(base), " ")
	// Nama yang hanya berisi tanda baca pemisah tidak berguna sebagai judul.
	if strings.Trim(base, " .-_") == "" {
		return "Audio"
	}
	return base
}

// streamTrack GET /api/music/{id}/media — mengalirkan berkas audio lokal.
// http.ServeContent dipakai agar permintaan Range (lompat posisi di pemutar)
// ditangani Windows/WebView2 dengan benar.
func (s *Server) streamTrack(w http.ResponseWriter, r *http.Request) error {
	id := paramInt(r, "id")
	row, err := s.database.SelectOne(
		"SELECT kind, file_name, title FROM music_tracks WHERE id = ? AND company_id = ?", id, s.companyID())
	if err != nil {
		return err
	}
	if row == nil {
		return fail(http.StatusNotFound, "Lagu tidak ditemukan.")
	}
	if db.AsString(row["kind"]) != "LOCAL" {
		return fail(http.StatusNotFound, "Lagu ini hanya berupa tautan YouTube.")
	}
	stored := db.AsString(row["file_name"])
	if stored == "" {
		return fail(http.StatusNotFound, "Berkas audio lagu ini tidak ada di penyimpanan.")
	}

	dir, err := s.musicDir()
	if err != nil {
		return err
	}
	// Hanya nama dasar yang dipakai: berkas tidak dapat menunjuk ke luar folder musik.
	path := filepath.Join(dir, filepath.Base(stored))
	file, err := os.Open(path)
	if err != nil {
		return fail(http.StatusNotFound, "Berkas audio lagu ini tidak ditemukan di penyimpanan.")
	}
	defer func() { _ = file.Close() }()
	info, err := file.Stat()
	if err != nil {
		return err
	}

	w.Header().Set("Content-Type", audioContentType(path))
	w.Header().Set("Cache-Control", "private, max-age=86400")
	http.ServeContent(w, r, filepath.Base(path), info.ModTime(), file)
	return nil
}

// audioContentType menentukan MIME dari ekstensi berkas audio.
func audioContentType(name string) string {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".mp3":
		return "audio/mpeg"
	case ".m4a", ".aac":
		return "audio/mp4"
	case ".ogg", ".oga", ".opus":
		return "audio/ogg"
	case ".wav":
		return "audio/wav"
	case ".flac":
		return "audio/flac"
	case ".weba":
		return "audio/webm"
	default:
		return "application/octet-stream"
	}
}

// deleteTrack DELETE /api/music/{id} — hapus baris dan berkas audionya (bila lokal).
func (s *Server) deleteTrack(w http.ResponseWriter, r *http.Request) error {
	id := paramInt(r, "id")
	row, err := s.database.SelectOne(
		"SELECT kind, file_name FROM music_tracks WHERE id = ? AND company_id = ?", id, s.companyID())
	if err != nil {
		return err
	}
	if row == nil {
		return fail(http.StatusNotFound, "Lagu tidak ditemukan.")
	}

	removed, err := s.database.Exec("DELETE FROM music_tracks WHERE id = ? AND company_id = ?", id, s.companyID())
	if err != nil {
		return err
	}
	if removed.AffectedRows == 0 {
		return fail(http.StatusNotFound, "Lagu tidak ditemukan.")
	}

	// Berkas fisik ikut dibuang setelah barisnya hilang; kegagalan menghapus
	// berkas tidak menggagalkan permintaan (baris sudah tidak ada).
	if stored := db.AsString(row["file_name"]); stored != "" {
		if dir, dirErr := s.musicDir(); dirErr == nil {
			_ = os.Remove(filepath.Join(dir, filepath.Base(stored)))
		}
	}
	return writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// putTrackOrder PUT /api/music/order { ids: [...] } — menyimpan urutan pustaka.
func (s *Server) putTrackOrder(w http.ResponseWriter, r *http.Request) error {
	body, err := readBody(r)
	if err != nil {
		return err
	}
	raw, ok := body["ids"].([]any)
	if !ok || len(raw) == 0 {
		return fail(http.StatusUnprocessableEntity, "Urutan pustaka tidak valid.")
	}
	err = s.database.WithTransaction(func(tx *db.Tx) error {
		for position, item := range raw {
			trackID := db.AsInt(item)
			if trackID == 0 {
				continue
			}
			if _, execErr := tx.Exec(
				"UPDATE music_tracks SET position = ? WHERE id = ? AND company_id = ?",
				position+1, trackID, s.companyID()); execErr != nil {
				return execErr
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
