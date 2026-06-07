#!/usr/bin/env python3
"""
Generate random song cover with aurora aesthetic.
Based on generate-app-icon.py but with randomized parameters.
"""

from PIL import Image, ImageDraw, ImageFilter
import random
import sys
import json

def create_gradient_blob(size, center_x, center_y, radius_x, radius_y, color, max_opacity):
    """Create a radial gradient blob with elliptical shape."""
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    r, g, b = color

    # Draw concentric ellipses with decreasing opacity
    steps = 100
    for i in range(steps, 0, -1):
        progress = i / steps
        opacity = int(max_opacity * (progress ** 1.8))
        current_rx = radius_x * progress
        current_ry = radius_y * progress

        bbox = [
            center_x - current_rx,
            center_y - current_ry,
            center_x + current_rx,
            center_y + current_ry
        ]
        draw.ellipse(bbox, fill=(r, g, b, opacity))

    return img

def create_random_song_cover(size=400, seed=None):
    """Create a random song cover with aurora aesthetic."""

    if seed:
        random.seed(seed)

    # Random base color (cream variants)
    base_colors = [
        '#F5F1EB',  # Original cream
        '#FFF9F0',  # Warmer cream
        '#F8F4EE',  # Neutral cream
        '#FFF5E6',  # Peachy cream
        '#F5F0E8',  # Cool cream
    ]
    base_color = random.choice(base_colors)
    icon = Image.new('RGB', (size, size), base_color)

    # Murmur color palette (oranges + complementary)
    color_palette = [
        (255, 89, 36),    # #FF5924 - Murmur accent
        (255, 138, 92),   # #FF8A5C - Light orange
        (217, 66, 26),    # #D9421A - Deep orange
        (255, 196, 163),  # #FFC4A3 - Peachy
        (255, 224, 64),   # Gold
        (255, 105, 180),  # Pink
        (170, 190, 255),  # Lavender
        (140, 230, 200),  # Mint
        (235, 203, 139),  # Warm gold
    ]

    # Random number of blobs (3-5)
    num_blobs = random.randint(3, 5)

    blobs = []
    for i in range(num_blobs):
        blobs.append({
            'center': (
                size * random.uniform(0.1, 0.9),
                size * random.uniform(0.1, 0.9)
            ),
            'radius': (
                size * random.uniform(0.2, 0.4),
                size * random.uniform(0.15, 0.35)
            ),
            'color': random.choice(color_palette),
            'opacity': random.randint(50, 140),
            'blur': size * random.uniform(0.05, 0.12)
        })

    # Composite blobs onto base
    for blob in blobs:
        blob_img = create_gradient_blob(
            size,
            blob['center'][0],
            blob['center'][1],
            blob['radius'][0],
            blob['radius'][1],
            blob['color'],
            blob['opacity']
        )

        # Apply gaussian blur
        blur_radius = int(blob['blur'])
        blob_img = blob_img.filter(ImageFilter.GaussianBlur(radius=blur_radius))

        # Composite onto base
        icon.paste(blob_img, (0, 0), blob_img)

    return icon

def main():
    """Generate a random song cover."""
    if len(sys.argv) < 2:
        print("Usage: generate-song-cover.py <output_path> [seed] [size]")
        sys.exit(1)

    output_path = sys.argv[1]
    seed = sys.argv[2] if len(sys.argv) > 2 else None
    size = int(sys.argv[3]) if len(sys.argv) > 3 else 400

    print(f"Generating cover (seed={seed}, size={size})...")
    cover = create_random_song_cover(size, seed)
    cover.save(output_path, 'PNG', optimize=True)
    print(f"✓ Saved to {output_path}")

if __name__ == '__main__':
    main()
