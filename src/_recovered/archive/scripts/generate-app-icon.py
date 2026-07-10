#!/usr/bin/env python3
"""
Generate Murmur app icon with aurora background aesthetic.
Inspired by HumScreen's compressed, ambient color gradients.
"""

from PIL import Image, ImageDraw, ImageFilter, ImageEnhance
import math

def create_gradient_blob(size, center_x, center_y, radius_x, radius_y, color, max_opacity):
    """Create a radial gradient blob with elliptical shape."""
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Parse RGB from hex or tuple
    if isinstance(color, str):
        color = color.lstrip('#')
        r, g, b = tuple(int(color[i:i+2], 16) for i in (0, 2, 4))
    else:
        r, g, b = color

    # Draw concentric ellipses with decreasing opacity (radial gradient effect)
    steps = 100
    for i in range(steps, 0, -1):
        progress = i / steps
        # Quadratic falloff for softer gradient
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

def create_rounded_mask(size):
    """Create iOS app icon rounded corner mask using Apple's squircle formula."""
    mask = Image.new('L', (size, size), 0)
    draw = ImageDraw.Draw(mask)

    # iOS uses ~22.37% corner radius for app icons (continuous curvature)
    # Approximate with rounded rectangle
    corner_radius = int(size * 0.2237)
    draw.rounded_rectangle(
        [(0, 0), (size, size)],
        radius=corner_radius,
        fill=255
    )
    return mask

def create_app_icon(size=1024, rounded=False):
    """Create the Murmur app icon with aurora aesthetic."""

    # Base cream background
    icon = Image.new('RGB', (size, size), '#F5F1EB')

    # Create compressed aurora blobs - smaller, more concentrated
    blobs = [
        # Pink/magenta - bottom left
        {
            'center': (size * 0.12, size * 0.78),
            'radius': (size * 0.35, size * 0.28),
            'color': (255, 105, 210),
            'opacity': 135,
            'blur': size * 0.09
        },
        # Gold/yellow - top right
        {
            'center': (size * 0.85, size * 0.18),
            'radius': (size * 0.32, size * 0.26),
            'color': (255, 224, 64),
            'opacity': 120,
            'blur': size * 0.08
        },
        # Lavender/blue - top left
        {
            'center': (size * 0.25, size * 0.15),
            'radius': (size * 0.28, size * 0.23),
            'color': (170, 190, 255),
            'opacity': 85,
            'blur': size * 0.075
        },
        # Mint green - bottom right (subtle)
        {
            'center': (size * 0.75, size * 0.72),
            'radius': (size * 0.22, size * 0.18),
            'color': (140, 230, 200),
            'opacity': 60,
            'blur': size * 0.065
        },
        # Coral accent - center right (warmth)
        {
            'center': (size * 0.78, size * 0.52),
            'radius': (size * 0.20, size * 0.16),
            'color': (255, 138, 92),
            'opacity': 50,
            'blur': size * 0.06
        }
    ]

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

        # Apply gaussian blur for soft, diffused look
        blur_radius = int(blob['blur'])
        blob_img = blob_img.filter(ImageFilter.GaussianBlur(radius=blur_radius))

        # Composite onto base
        icon.paste(blob_img, (0, 0), blob_img)

    # Load and composite the wordmark logo
    try:
        logo = Image.open('/Users/dujiayi/murmur/public/brand/murmur-wordmark-source-cropped.png')

        # Calculate logo size - should be about 78% of icon width
        logo_width = int(size * 0.78)
        aspect_ratio = logo.size[1] / logo.size[0]
        logo_height = int(logo_width * aspect_ratio)

        # Resize logo with high-quality resampling
        logo = logo.resize((logo_width, logo_height), Image.Resampling.LANCZOS)

        # Position logo in center
        logo_x = (size - logo_width) // 2
        logo_y = (size - logo_height) // 2

        # If logo has alpha channel, use it; otherwise assume white background
        if logo.mode == 'RGBA':
            icon.paste(logo, (logo_x, logo_y), logo)
        else:
            # Convert to RGBA and create mask from brightness
            logo_rgba = logo.convert('RGBA')
            # Create alpha mask: white -> transparent, dark -> opaque
            alpha = logo.convert('L')
            # Invert so dark areas are opaque
            from PIL import ImageOps
            alpha = ImageOps.invert(alpha)
            logo_rgba.putalpha(alpha)
            icon.paste(logo_rgba, (logo_x, logo_y), logo_rgba)

    except FileNotFoundError:
        print("Warning: Logo file not found, generating icon without logo")

    # Apply rounded corners if requested
    if rounded:
        mask = create_rounded_mask(size)
        icon.putalpha(mask)

    return icon

def main():
    """Generate app icons in multiple sizes."""
    sizes = [1024, 512, 256, 180, 120]

    print("Generating Murmur app icons...")

    for size in sizes:
        # Generate square version
        print(f"  Creating {size}×{size}...", end=' ')
        icon = create_app_icon(size, rounded=False)
        output_path = f'/Users/dujiayi/murmur/public/brand/murmur-app-icon-{size}.png'
        icon.save(output_path, 'PNG', optimize=True)
        print(f"✓")

        # Generate rounded version
        print(f"  Creating {size}×{size} (rounded)...", end=' ')
        icon_rounded = create_app_icon(size, rounded=True)
        output_rounded = f'/Users/dujiayi/murmur/public/brand/murmur-app-icon-{size}-rounded.png'
        icon_rounded.save(output_rounded, 'PNG', optimize=True)
        print(f"✓")

    print("\nDone! Icons saved to public/brand/")
    print("  Square versions: murmur-app-icon-{size}.png")
    print("  Rounded versions: murmur-app-icon-{size}-rounded.png")

if __name__ == '__main__':
    main()
