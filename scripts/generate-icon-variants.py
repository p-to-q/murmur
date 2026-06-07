#!/usr/bin/env python3
"""
Generate multiple Murmur app icon variants with different aurora aesthetics.
"""

from PIL import Image, ImageDraw, ImageFilter
import os

def create_gradient_blob(size, center_x, center_y, radius_x, radius_y, color, max_opacity):
    """Create a radial gradient blob with elliptical shape."""
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    if isinstance(color, str):
        color = color.lstrip('#')
        r, g, b = tuple(int(color[i:i+2], 16) for i in (0, 2, 4))
    else:
        r, g, b = color

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

def create_rounded_mask(size):
    """Create iOS app icon rounded corner mask."""
    mask = Image.new('L', (size, size), 0)
    draw = ImageDraw.Draw(mask)
    corner_radius = int(size * 0.2237)
    draw.rounded_rectangle([(0, 0), (size, size)], radius=corner_radius, fill=255)
    return mask

# Different aurora variants
VARIANTS = {
    'v1-balanced': {
        'name': 'Balanced (原版增强)',
        'base_color': '#F5F1EB',
        'blobs': [
            {'center': (0.12, 0.78), 'radius': (0.35, 0.28), 'color': (255, 105, 210), 'opacity': 135, 'blur': 0.09},
            {'center': (0.85, 0.18), 'radius': (0.32, 0.26), 'color': (255, 224, 64), 'opacity': 120, 'blur': 0.08},
            {'center': (0.25, 0.15), 'radius': (0.28, 0.23), 'color': (170, 190, 255), 'opacity': 85, 'blur': 0.075},
            {'center': (0.75, 0.72), 'radius': (0.22, 0.18), 'color': (140, 230, 200), 'opacity': 60, 'blur': 0.065},
            {'center': (0.78, 0.52), 'radius': (0.20, 0.16), 'color': (255, 138, 92), 'opacity': 50, 'blur': 0.06},
        ]
    },
    'v2-warm-sunset': {
        'name': 'Warm Sunset (暖色调)',
        'base_color': '#F5F1EB',
        'blobs': [
            {'center': (0.15, 0.75), 'radius': (0.40, 0.32), 'color': (255, 89, 36), 'opacity': 140, 'blur': 0.10},
            {'center': (0.80, 0.25), 'radius': (0.38, 0.30), 'color': (255, 200, 80), 'opacity': 130, 'blur': 0.09},
            {'center': (0.50, 0.85), 'radius': (0.28, 0.22), 'color': (255, 138, 92), 'opacity': 100, 'blur': 0.075},
            {'center': (0.85, 0.65), 'radius': (0.25, 0.20), 'color': (235, 203, 139), 'opacity': 80, 'blur': 0.07},
        ]
    },
    'v3-cool-dream': {
        'name': 'Cool Dream (冷色调)',
        'base_color': '#F5F1EB',
        'blobs': [
            {'center': (0.20, 0.20), 'radius': (0.40, 0.32), 'color': (167, 184, 200), 'opacity': 120, 'blur': 0.09},
            {'center': (0.75, 0.30), 'radius': (0.35, 0.28), 'color': (201, 182, 228), 'opacity': 110, 'blur': 0.085},
            {'center': (0.15, 0.70), 'radius': (0.30, 0.24), 'color': (140, 230, 200), 'opacity': 90, 'blur': 0.08},
            {'center': (0.80, 0.75), 'radius': (0.28, 0.22), 'color': (170, 190, 255), 'opacity': 100, 'blur': 0.075},
        ]
    },
    'v4-vibrant': {
        'name': 'Vibrant (高饱和)',
        'base_color': '#F5F1EB',
        'blobs': [
            {'center': (0.10, 0.80), 'radius': (0.38, 0.30), 'color': (255, 69, 180), 'opacity': 160, 'blur': 0.08},
            {'center': (0.88, 0.15), 'radius': (0.36, 0.28), 'color': (255, 224, 64), 'opacity': 150, 'blur': 0.075},
            {'center': (0.50, 0.10), 'radius': (0.30, 0.24), 'color': (138, 150, 255), 'opacity': 120, 'blur': 0.07},
            {'center': (0.85, 0.70), 'radius': (0.26, 0.20), 'color': (100, 255, 180), 'opacity': 110, 'blur': 0.065},
            {'center': (0.45, 0.88), 'radius': (0.24, 0.18), 'color': (255, 100, 60), 'opacity': 130, 'blur': 0.06},
        ]
    },
    'v5-minimal': {
        'name': 'Minimal (极简)',
        'base_color': '#F5F1EB',
        'blobs': [
            {'center': (0.25, 0.75), 'radius': (0.45, 0.38), 'color': (255, 138, 92), 'opacity': 100, 'blur': 0.12},
            {'center': (0.75, 0.25), 'radius': (0.42, 0.35), 'color': (201, 182, 228), 'opacity': 80, 'blur': 0.11},
        ]
    },
    'v6-centered': {
        'name': 'Centered (中心发散)',
        'base_color': '#F5F1EB',
        'blobs': [
            {'center': (0.50, 0.50), 'radius': (0.50, 0.50), 'color': (255, 200, 120), 'opacity': 80, 'blur': 0.15},
            {'center': (0.20, 0.25), 'radius': (0.32, 0.26), 'color': (255, 105, 210), 'opacity': 120, 'blur': 0.09},
            {'center': (0.78, 0.30), 'radius': (0.30, 0.24), 'color': (170, 190, 255), 'opacity': 100, 'blur': 0.08},
            {'center': (0.70, 0.75), 'radius': (0.28, 0.22), 'color': (140, 230, 200), 'opacity': 90, 'blur': 0.075},
            {'center': (0.25, 0.72), 'radius': (0.26, 0.20), 'color': (255, 224, 64), 'opacity': 110, 'blur': 0.07},
        ]
    },
}

def create_app_icon_variant(size, variant_key, rounded=False):
    """Create app icon with specific variant configuration."""
    variant = VARIANTS[variant_key]

    # Base background
    icon = Image.new('RGB', (size, size), variant['base_color'])

    # Apply blobs
    for blob_config in variant['blobs']:
        blob_img = create_gradient_blob(
            size,
            size * blob_config['center'][0],
            size * blob_config['center'][1],
            size * blob_config['radius'][0],
            size * blob_config['radius'][1],
            blob_config['color'],
            blob_config['opacity']
        )

        blur_radius = int(size * blob_config['blur'])
        blob_img = blob_img.filter(ImageFilter.GaussianBlur(radius=blur_radius))
        icon.paste(blob_img, (0, 0), blob_img)

    # Load and composite logo
    try:
        logo = Image.open('/Users/dujiayi/murmur/public/brand/murmur-wordmark-source-cropped.png')
        logo_width = int(size * 0.78)
        aspect_ratio = logo.size[1] / logo.size[0]
        logo_height = int(logo_width * aspect_ratio)
        logo = logo.resize((logo_width, logo_height), Image.Resampling.LANCZOS)

        logo_x = (size - logo_width) // 2
        logo_y = (size - logo_height) // 2

        if logo.mode == 'RGBA':
            icon.paste(logo, (logo_x, logo_y), logo)
        else:
            logo_rgba = logo.convert('RGBA')
            from PIL import ImageOps
            alpha = ImageOps.invert(logo.convert('L'))
            logo_rgba.putalpha(alpha)
            icon.paste(logo_rgba, (logo_x, logo_y), logo_rgba)
    except FileNotFoundError:
        print("Warning: Logo not found")

    # Apply rounded corners if requested
    if rounded:
        mask = create_rounded_mask(size)
        icon.putalpha(mask)

    return icon

def main():
    """Generate all variant icons."""
    size = 1024
    output_dir = '/Users/dujiayi/murmur/public/brand/variants'

    os.makedirs(output_dir, exist_ok=True)

    print("Generating Murmur app icon variants...\n")

    for variant_key, variant_info in VARIANTS.items():
        print(f"📦 {variant_info['name']}")

        # Square version
        icon = create_app_icon_variant(size, variant_key, rounded=False)
        square_path = f'{output_dir}/{variant_key}-square.png'
        icon.save(square_path, 'PNG', optimize=True)
        print(f"   ✓ Square: {square_path}")

        # Rounded version
        icon_rounded = create_app_icon_variant(size, variant_key, rounded=True)
        rounded_path = f'{output_dir}/{variant_key}-rounded.png'
        icon_rounded.save(rounded_path, 'PNG', optimize=True)
        print(f"   ✓ Rounded: {rounded_path}\n")

    print(f"\nDone! {len(VARIANTS)} variants × 2 versions generated in:")
    print(f"  {output_dir}/")

if __name__ == '__main__':
    main()
