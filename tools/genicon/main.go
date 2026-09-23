// Command genicon menggambar ikon aplikasi Finova dan menulisnya ke
// build/windows/icon.ico (dipakai NSIS + metadata exe) serta build/appicon.png.
//
//	go run ./tools/genicon
//
// Semua bentuk digambar prosedural supaya tidak ada berkas binary yang perlu
// diunduh atau disimpan tangan, dan hasilnya bisa dibangun ulang kapan pun.
package main

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"math"
	"os"
	"path/filepath"
)

const size = 256

// palet mengikuti tema aplikasi: hijau tuang gelap ke biru laut, aksen emas.
var (
	topColor    = color.RGBA{R: 15, G: 118, B: 110, A: 255}
	bottomColor = color.RGBA{R: 12, G: 74, B: 110, A: 255}
	ink         = color.RGBA{R: 255, G: 255, B: 255, A: 255}
	accent      = color.RGBA{R: 250, G: 204, B: 21, A: 255}
	softInk     = color.RGBA{R: 255, G: 255, B: 255, A: 170}
)

func main() {
	outDir := "build/windows"
	if len(os.Args) > 1 {
		outDir = os.Args[1]
	}
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		fail(err)
	}

	big := drawIcon(size)
	if err := writePNG(filepath.Join("build", "appicon.png"), big); err != nil {
		fail(err)
	}

	sizes := []int{256, 128, 64, 48, 32, 16}
	images := make([][]byte, 0, len(sizes))
	for _, s := range sizes {
		scaled := scale(big, s)
		buffer, err := encodePNG(scaled)
		if err != nil {
			fail(err)
		}
		images = append(images, buffer)
	}
	ico := filepath.Join(outDir, "icon.ico")
	if err := writeICO(ico, sizes, images); err != nil {
		fail(err)
	}
	fmt.Printf("Ikon dibuat: %s dan build/appicon.png\n", ico)
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, "genicon gagal:", err)
	os.Exit(1)
}

// drawIcon menggambar latar bulat bersudut lengkung dengan buku jurnal bergaris
// dan aksen saldo pada kanvas square berukuran size.
func drawIcon(size int) *image.RGBA {
	img := image.NewRGBA(image.Rect(0, 0, size, size))
	radius := float64(size) * 0.22

	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			if !insideRounded(x, y, size, radius) {
				img.Set(x, y, color.RGBA{})
				continue
			}
			t := float64(y) / float64(size)
			img.Set(x, y, blend(topColor, bottomColor, t))
		}
	}

	// Kertas jurnal: persegi panjang membulat di tengah kanan.
	paper := image.Rect(
		int(float64(size)*0.26), int(float64(size)*0.20),
		int(float64(size)*0.78), int(float64(size)*0.82),
	)
	drawRoundedRect(img, paper, float64(size)*0.05, color.RGBA{R: 248, G: 250, B: 252, A: 255})

	unit := float64(size) / 100
	// Garis-garis jurnal (kolom debit) dan baris aksen emas (kolom kredit).
	for i := 0; i < 4; i++ {
		y := float64(paper.Min.Y) + unit*14 + float64(i)*unit*14
		drawBar(img, float64(paper.Min.X)+unit*8, y, unit*34, unit*4, softInk)
	}
	drawBar(img, float64(paper.Min.X)+unit*48, float64(paper.Min.Y)+unit*14, unit*10, unit*4, accent)
	drawBar(img, float64(paper.Min.X)+unit*48, float64(paper.Min.Y)+unit*56, unit*10, unit*4, topColor)

	// Pembatas kolom debit/kredit.
	drawBar(img, float64(paper.Min.X)+unit*44, float64(paper.Min.Y)+unit*8, unit*1.2, unit*58, softInk)

	// Centang kecil di sudut: menandakan "seimbang / sudah diverifikasi".
	check := []image.Point{
		pt(size, 0.10, 0.62), pt(size, 0.19, 0.72), pt(size, 0.34, 0.50),
	}
	drawThickLine(img, check[0], check[1], unit*4.5, ink)
	drawThickLine(img, check[1], check[2], unit*4.5, ink)
	return img
}

func pt(size int, fx, fy float64) image.Point {
	return image.Point{X: int(float64(size) * fx), Y: int(float64(size) * fy)}
}

func insideRounded(x, y, size int, radius float64) bool {
	max := float64(size - 1)
	dx := float64(x)
	dy := float64(y)
	switch {
	case dx <= radius || dx >= max-radius:
		cx := radius
		if dx > max/2 {
			cx = max - radius
		}
		cy := radius
		if dy > max/2 {
			cy = max - radius
		}
		if dy < radius || dy > max-radius {
			return (dx-cx)*(dx-cx)+(dy-cy)*(dy-cy) <= radius*radius
		}
		return true
	case dy <= radius || dy >= max-radius:
		return true
	default:
		return true
	}
}

func drawRoundedRect(dst *image.RGBA, r image.Rectangle, radius float64, c color.RGBA) {
	for y := r.Min.Y; y < r.Max.Y; y++ {
		for x := r.Min.X; x < r.Max.X; x++ {
			if insideRounded(x-r.Min.X, y-r.Min.Y, r.Dx(), radius) &&
				insideRounded(x-r.Min.X, y-r.Min.Y, r.Dy(), radius) {
				dst.Set(x, y, c)
			}
		}
	}
}

func drawBar(dst *image.RGBA, x, y, width, height float64, c color.RGBA) {
	for py := int(y); py < int(y+height); py++ {
		for px := int(x); px < int(x+width); px++ {
			if px >= 0 && py >= 0 && px < dst.Bounds().Dx() && py < dst.Bounds().Dy() {
				dst.Set(px, py, c)
			}
		}
	}
}

func drawThickLine(dst *image.RGBA, a, b image.Point, thickness float64, c color.RGBA) {
	steps := int(math.Max(math.Abs(float64(b.X-a.X)), math.Abs(float64(b.Y-a.Y)))) * 2
	if steps == 0 {
		steps = 1
	}
	for i := 0; i <= steps; i++ {
		t := float64(i) / float64(steps)
		cx := float64(a.X) + t*float64(b.X-a.X)
		cy := float64(a.Y) + t*float64(b.Y-a.Y)
		r := thickness / 2
		for dy := -r; dy <= r; dy++ {
			for dx := -r; dx <= r; dx++ {
				if dx*dx+dy*dy <= r*r {
					px, py := int(cx+dx), int(cy+dy)
					if px >= 0 && py >= 0 && px < dst.Bounds().Dx() && py < dst.Bounds().Dy() {
						draw.Draw(dst, image.Rect(px, py, px+1, py+1), image.NewUniform(c), image.Point{}, draw.Over)
					}
				}
			}
		}
	}
}

func blend(a, b color.RGBA, t float64) color.RGBA {
	// Perpaduan di ruang linier sederhana agar transisi tetap halus.
	gamma := 2.2
	pow := func(v uint8) float64 { return math.Pow(float64(v)/255, gamma) }
	mix := func(x, y uint8) uint8 {
		value := pow(x)*(1-t) + pow(y)*t
		return uint8(math.Round(math.Pow(value, 1/gamma) * 255))
	}
	return color.RGBA{R: mix(a.R, b.R), G: mix(a.G, b.G), B: mix(a.B, b.B), A: 255}
}

// scale meniru pembesaran bilinear sederhana supaya ikon kecil tetap terbaca.
func scale(src *image.RGBA, target int) *image.RGBA {
	dst := image.NewRGBA(image.Rect(0, 0, target, target))
	source := float64(src.Bounds().Dx())
	ratio := source / float64(target)
	for y := 0; y < target; y++ {
		for x := 0; x < target; x++ {
			var r, g, b, a, n float64
			for sy := int(float64(y) * ratio); sy < int((float64(y)+1)*ratio) && sy < src.Bounds().Dy(); sy++ {
				for sx := int(float64(x) * ratio); sx < int((float64(x)+1)*ratio) && sx < src.Bounds().Dx(); sx++ {
					cr, cg, cb, ca := src.At(sx, sy).RGBA()
					r += float64(cr)
					g += float64(cg)
					b += float64(cb)
					a += float64(ca)
					n++
				}
			}
			if n == 0 {
				continue
			}
			dst.Set(x, y, color.NRGBA{
				R: uint8(r / n / 257), G: uint8(g / n / 257),
				B: uint8(b / n / 257), A: uint8(a / n / 257),
			})
		}
	}
	return dst
}

func encodePNG(img image.Image) ([]byte, error) {
	buffer := &bytes.Buffer{}
	if err := png.Encode(buffer, img); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

func writePNG(path string, img image.Image) error {
	data, err := encodePNG(img)
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}

// writeICO membungkus gambar PNG ke dalam container ICO (format yang diterima
// Windows Vista dan seterusnya, termasuk entris 256 px yang tingginya ditulis 0).
func writeICO(path string, sizes []int, payloads [][]byte) error {
	out := &bytes.Buffer{}
	header := make([]byte, 0, 6)
	header = binary.LittleEndian.AppendUint16(header, 0) // reserved
	header = binary.LittleEndian.AppendUint16(header, 1) // tipe ikon
	header = binary.LittleEndian.AppendUint16(header, uint16(len(sizes)))
	out.Write(header)

	offset := uint32(6 + 16*len(sizes))
	entries := make([]byte, 0, 16*len(sizes))
	for index, sizePx := range sizes {
		payload := payloads[index]
		widthByte, heightByte := byte(sizePx), byte(sizePx)
		if sizePx >= 256 {
			widthByte, heightByte = 0, 0
		}
		entries = append(entries, widthByte, heightByte, 0, 0)
		entries = binary.LittleEndian.AppendUint16(entries, 1)  // plan
		entries = binary.LittleEndian.AppendUint16(entries, 32) // bit per pixel
		entries = binary.LittleEndian.AppendUint32(entries, uint32(len(payload)))
		entries = binary.LittleEndian.AppendUint32(entries, offset)
		offset += uint32(len(payload))
	}
	out.Write(entries)
	for _, payload := range payloads {
		out.Write(payload)
	}
	return os.WriteFile(path, out.Bytes(), 0o644)
}
