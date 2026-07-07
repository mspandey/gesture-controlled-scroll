"""
generate_icons.py — Creates valid PNG icons for GestureScroll extension.
Run: python generate_icons.py

Generates icon16.png, icon32.png, icon48.png, icon128.png
in assets/icons/ using only Python's standard library (struct + zlib).
No Pillow or external dependencies required.
"""

import struct
import zlib
import os
import math

def make_png(width, height, pixels_rgba):
    """
    Encode RGBA pixel data (flat list: [R,G,B,A, R,G,B,A, ...]) as a valid PNG binary.
    Uses zlib deflate compression (standard library).
    """
    # Build raw scanline data: filter byte 0 (None) + RGBA per pixel
    raw = bytearray()
    for y in range(height):
        raw.append(0)  # filter type: None
        for x in range(width):
            i = (y * width + x) * 4
            raw.extend(pixels_rgba[i:i+4])
    
    compressed = zlib.compress(bytes(raw), 9)
    
    def chunk(tag, data):
        b = tag.encode('ascii') + data
        crc = zlib.crc32(b) & 0xffffffff
        return struct.pack('>I', len(data)) + b + struct.pack('>I', crc)
    
    sig = b'\x89PNG\r\n\x1a\n'
    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    idat_data = compressed
    
    return sig + chunk('IHDR', ihdr_data) + chunk('IDAT', idat_data) + chunk('IEND', b'')


def lerp(a, b, t):
    return int(a + (b - a) * t)


def create_gesture_scroll_icon(size):
    """
    Creates a purple-gradient circular icon with a white hand silhouette.
    Returns flat RGBA bytes list.
    """
    pixels = [0] * (size * size * 4)
    cx = size / 2
    cy = size / 2
    r = size / 2 - 0.5

    for y in range(size):
        for x in range(size):
            dx = x - cx
            dy = y - cy
            dist = math.sqrt(dx * dx + dy * dy)
            idx = (y * size + x) * 4

            if dist > r:
                # Transparent outside circle
                pixels[idx:idx+4] = [0, 0, 0, 0]
                continue

            # Anti-alias at edge
            edge_alpha = min(1.0, (r - dist + 1.0))
            alpha = int(255 * edge_alpha)

            # Gradient background: indigo → violet
            t = (x + y) / (size * 2.0)
            bg_r = lerp(99, 139, t)
            bg_g = lerp(102, 92, t)
            bg_b = lerp(241, 246, t)

            # Normalised coords (-1 to 1)
            nx = dx / (r * 0.75)
            ny = dy / (r * 0.75)

            # Draw simple upward-pointing hand shape in white
            in_hand = False

            # Palm
            if -0.55 < nx < 0.55 and 0.05 < ny < 0.75:
                in_hand = True

            # Index finger (center, tallest)
            if -0.18 < nx < 0.18 and -1.0 < ny < 0.25:
                in_hand = True

            # Middle finger
            if 0.12 < nx < 0.40 and -0.85 < ny < 0.20:
                in_hand = True

            # Ring finger
            if 0.35 < nx < 0.60 and -0.60 < ny < 0.30:
                in_hand = True

            # Pinky finger
            if -0.60 < nx < -0.35 and -0.45 < ny < 0.35:
                in_hand = True

            # Thumb (left side, angled)
            if -0.80 < nx < -0.40 and 0.10 < ny < 0.55:
                in_hand = True

            if in_hand:
                # White with slight transparency for polish
                pixels[idx:idx+4] = [250, 250, 255, alpha]
            else:
                pixels[idx:idx+4] = [bg_r, bg_g, bg_b, alpha]

    return pixels


def main():
    out_dir = os.path.join(os.path.dirname(__file__), 'assets', 'icons')
    os.makedirs(out_dir, exist_ok=True)

    for size in [16, 32, 48, 128]:
        pixels = create_gesture_scroll_icon(size)
        png_bytes = make_png(size, size, pixels)
        out_path = os.path.join(out_dir, f'icon{size}.png')
        with open(out_path, 'wb') as f:
            f.write(png_bytes)
        print(f'[icons] Generated icon{size}.png ({len(png_bytes)} bytes)')

    print('[icons] All icons generated successfully.')


if __name__ == '__main__':
    main()
