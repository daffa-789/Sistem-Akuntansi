package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"finova/internal/db"
)

// Pemutar musik Finova. Server hanya menyimpan tautan video YouTube (judul, pemegang
// hak, sampul) — tidak ada berkas audio yang disalin atau disimpan di sini.

// youtubeID mencocokkan 11 karakter ID video.
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

// oEmbedResult bentuk respons oEmbed YouTube yang dipakai untuk mengisi judul otomatis.
type oEmbedResult struct {
	Title        string `json:"title"`
	AuthorName   string `json:"author_name"`
	ThumbnailURL string `json:"thumbnail_url"`
}

// lookupVideo meminta metadata publik video lewat endpoint oEmbed resmi YouTube.
// Bila jaringan tidak tersedia (mis. pemasangan luring), fungsi mengembalikan nol
// tanpa error agar pengguna tetap bisa menyimpan tautan dengan judul sendiri.
func lookupVideo(id string) (oEmbedResult, bool) {
	client := &http.Client{Timeout: 3 * time.Second}
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

// thumbnailFor memakai endpoint gambar publik YouTube beresolusi tinggi.
func thumbnailFor(id string) string {
	return fmt.Sprintf("https://i.ytimg.com/vi/%s/hqdefault.jpg", id)
}

// getTracks GET /api/tracks
func (s *Server) getTracks(w http.ResponseWriter, _ *http.Request) error {
	tracks, err := s.database.Select(
		"SELECT * FROM music_tracks WHERE company_id = ? ORDER BY position, id", s.companyID())
	if err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, map[string]any{"tracks": tracks})
}

// postTrack POST /api/tracks { title?, artist?, youtubeId | url }
func (s *Server) postTrack(w http.ResponseWriter, r *http.Request) error {
	body, err := readBody(r)
	if err != nil {
		return err
	}
	id := videoIDFromURL(bodyText(body, "youtubeId", "url", "link"))
	if id == "" {
		return fail(http.StatusUnprocessableEntity, "Tautan YouTube tidak dikenali. Tempel URL video atau 11 karakter ID-nya.")
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
		return fail(http.StatusUnprocessableEntity, "Judul tidak dapat diambil otomatis (jaringan terbatas). Isi judul sendiri lalu simpan.")
	}
	if thumbnail == "" {
		thumbnail = thumbnailFor(id)
	}
	var maxPosition int64
	if row, err := s.database.SelectOne(
		"SELECT COALESCE(MAX(position), 0) AS position FROM music_tracks WHERE company_id = ?", s.companyID()); err == nil && row != nil {
		maxPosition = db.AsInt(row["position"])
	}
	created, err := s.database.Exec(
		`INSERT INTO music_tracks (company_id, title, artist, youtube_id, thumbnail_url, added_by, position)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		s.companyID(), title, artist, id, thumbnail, s.operatorID, maxPosition+1)
	if err != nil {
		return err
	}
	return writeJSON(w, http.StatusCreated, map[string]any{
		"id": created.InsertID, "youtubeId": id, "title": title, "artist": artist, "thumbnailUrl": thumbnail,
	})
}

// deleteTrack DELETE /api/tracks/{id}
func (s *Server) deleteTrack(w http.ResponseWriter, r *http.Request) error {
	removed, err := s.database.Exec("DELETE FROM music_tracks WHERE id = ? AND company_id = ?",
		paramInt(r, "id"), s.companyID())
	if err != nil {
		return err
	}
	if removed.AffectedRows == 0 {
		return fail(http.StatusNotFound, "Lagu tidak ditemukan.")
	}
	return writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// putTrackOrder PUT /api/tracks/order { ids: [..] } — menyimpan urutan daftar putar.
func (s *Server) putTrackOrder(w http.ResponseWriter, r *http.Request) error {
	body, err := readBody(r)
	if err != nil {
		return err
	}
	raw, ok := body["ids"].([]any)
	if !ok || len(raw) == 0 {
		return fail(http.StatusUnprocessableEntity, "Urutan daftar putar tidak valid.")
	}
	err = s.database.WithTransaction(func(tx *db.Tx) error {
		for position, item := range raw {
			trackID := db.AsInt(item)
			if trackID == 0 {
				continue
			}
			if _, execErr := tx.Exec("UPDATE music_tracks SET position = ? WHERE id = ? AND company_id = ?",
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
