import os
import math
from PIL import Image, ImageDraw, ImageFilter

def create_finova_icon(size=512):
    # Buat image RGBA resolusi tinggi dengan supersampling untuk anti-aliasing sempurna
    scale = 2
    actual_size = size * scale
    img = Image.new("RGBA", (actual_size, actual_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    margin = 32 * scale
    rect_box = [margin, margin, actual_size - margin, actual_size - margin]
    radius = 96 * scale

    # 1. Outer Glow Effect
    glow_img = Image.new("RGBA", (actual_size, actual_size), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow_img)
    glow_draw.rounded_rectangle(rect_box, radius=radius, fill=(16, 185, 129, 90))
    glow_img = glow_img.filter(ImageFilter.GaussianBlur(radius=24 * scale))
    img.alpha_composite(glow_img)

    # 2. Main Squircle Body (Gradient Background: Dark Deep Slate to Midnight Emerald)
    body_img = Image.new("RGBA", (actual_size, actual_size), (0, 0, 0, 0))
    body_draw = ImageDraw.Draw(body_img)
    
    # Draw vertical gradient inside mask
    mask = Image.new("L", (actual_size, actual_size), 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.rounded_rectangle(rect_box, radius=radius, fill=255)

    gradient = Image.new("RGBA", (actual_size, actual_size))
    for y in range(actual_size):
        ratio = y / actual_size
        # Dark Obsidian (#080d1a) to Deep Cyan/Navy (#041926)
        r = int(8 * (1 - ratio) + 4 * ratio)
        g = int(13 * (1 - ratio) + 25 * ratio)
        b = int(26 * (1 - ratio) + 38 * ratio)
        for x in range(actual_size):
            gradient.putpixel((x, y), (r, g, b, 255))
    
    img.paste(gradient, (0, 0), mask)

    # 3. Futuristic Border Gradient (Emerald to Cyan to Amber)
    border_width = 8 * scale
    border_mask = Image.new("L", (actual_size, actual_size), 0)
    b_draw = ImageDraw.Draw(border_mask)
    b_draw.rounded_rectangle(rect_box, radius=radius, outline=255, width=border_width)

    border_gradient = Image.new("RGBA", (actual_size, actual_size))
    for y in range(actual_size):
        ratio = y / actual_size
        # Emerald (#10b981) to Electric Cyan (#06b6d4)
        r = int(16 * (1 - ratio) + 6 * ratio)
        g = int(185 * (1 - ratio) + 182 * ratio)
        b = int(129 * (1 - ratio) + 212 * ratio)
        for x in range(actual_size):
            border_gradient.putpixel((x, y), (r, g, b, 230))
    
    img.paste(border_gradient, (0, 0), border_mask)

    # 4. Central Emblem: Modern Geometric Finova "F" + Growth Arrow
    # Coordinates normalized to 512, then scaled
    def S(v):
        return int(v * scale)

    # Stem of 'F' (Vertical Pillar with Rounded Ends)
    stem_points = [S(140), S(130), S(200), S(382)]
    draw.rounded_rectangle(stem_points, radius=S(26), fill=(6, 182, 212, 255))

    # Inner subtle glow on stem
    draw.rounded_rectangle([S(146), S(136), S(194), S(376)], radius=S(20), fill=(52, 211, 153, 255))

    # Top Bar of 'F' (Extending rightward like a sleek wing)
    top_bar = [
        (S(180), S(130)),
        (S(360), S(130)),
        (S(385), S(165)),
        (S(345), S(195)),
        (S(180), S(195)),
    ]
    draw.polygon(top_bar, fill=(16, 185, 129, 255))

    # Top Bar Highlight (Cyan shimmer)
    top_highlight = [
        (S(200), S(138)),
        (S(340), S(138)),
        (S(355), S(160)),
        (S(330), S(178)),
        (S(200), S(178)),
    ]
    draw.polygon(top_highlight, fill=(52, 211, 153, 255))

    # Middle Bar of 'F' with Gold Accent (#fbbf24 - #f59e0b)
    mid_bar = [
        (S(180), S(225)),
        (S(305), S(225)),
        (S(325), S(255)),
        (S(295), S(280)),
        (S(180), S(280)),
    ]
    draw.polygon(mid_bar, fill=(245, 158, 11, 255))

    mid_highlight = [
        (S(195), S(233)),
        (S(290), S(233)),
        (S(305), S(255)),
        (S(280), S(272)),
        (S(195), S(272)),
    ]
    draw.polygon(mid_highlight, fill=(251, 191, 36, 255))

    # 5. Upward Growth Spark (Dynamic 4-pointed Diamond / Star at top right)
    cx, cy = S(390), S(105)
    r_outer = S(32)
    r_inner = S(10)
    star_points = [
        (cx, cy - r_outer),
        (cx + r_inner, cy - r_inner),
        (cx + r_outer, cy),
        (cx + r_inner, cy + r_inner),
        (cx, cy + r_outer),
        (cx - r_inner, cy + r_inner),
        (cx - r_outer, cy),
        (cx - r_inner, cy - r_inner),
    ]
    # Spark glow
    draw.polygon(star_points, fill=(254, 240, 138, 255))
    draw.ellipse([cx - S(6), cy - S(6), cx + S(6), cy + S(6)], fill=(255, 255, 255, 255))

    # Downsample from supersampling (LANCZOS filter for crisp, ultra-clean edges)
    final_img = img.resize((size, size), Image.Resampling.LANCZOS)
    return final_img

def main():
    os.makedirs("build/windows", exist_ok=True)
    os.makedirs("public", exist_ok=True)

    master = create_finova_icon(512)
    master.save("build/appicon.png", format="PNG")
    print("Saved build/appicon.png (512x512)")

    # Simpan favicon web
    fav64 = master.resize((64, 64), Image.Resampling.LANCZOS)
    fav64.save("public/favicon.png", format="PNG")
    fav32 = master.resize((32, 32), Image.Resampling.LANCZOS)
    fav32.save("public/favicon.ico", format="ICO")
    print("Saved public/favicon.png & public/favicon.ico")

    # Multi-resolution ICO untuk Windows: 256, 128, 64, 48, 32, 16
    sizes = [256, 128, 64, 48, 32, 16]
    ico_images = [master.resize((s, s), Image.Resampling.LANCZOS) for s in sizes]
    ico_path = "build/windows/icon.ico"
    ico_images[0].save(ico_path, format="ICO", sizes=[(s, s) for s in sizes])
    print(f"Saved {ico_path} with resolutions: {sizes}")

if __name__ == "__main__":
    main()
