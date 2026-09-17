import os
from PIL import Image, ImageFilter
import numpy as np

def process_logo():
    input_path = 'logo.jpeg'
    public_dir = 'public'
    assets_dir = 'src/assets'
    os.makedirs(public_dir, exist_ok=True)
    os.makedirs(assets_dir, exist_ok=True)

    img = Image.open(input_path).convert('RGB')
    arr = np.array(img).astype(float)
    bg = np.array([247.0, 247.0, 247.0])
    dist = np.linalg.norm(arr - bg, axis=2)
    chroma = np.max(arr, axis=2) - np.min(arr, axis=2)

    # Distinguish icon from light gray shadow
    is_icon = ((chroma > 12) & (dist > 50)) | ((np.mean(arr, axis=2) < 120) & (dist > 100))

    # Center of squircle is (511.5, 279.5), size 336x336
    cx, cy = 511.5, 279.5
    size = 336
    x0, y0 = int(cx - size/2), int(cy - size/2)

    cropped_img = img.crop((x0, y0, x0 + size, y0 + size))
    cropped_mask = Image.fromarray((is_icon[y0:y0+size, x0:x0+size] * 255).astype(np.uint8), 'L')
    mask_smooth = cropped_mask.filter(ImageFilter.GaussianBlur(radius=1.0))

    rgba = cropped_img.convert('RGBA')
    rgba.putalpha(mask_smooth)

    # Master high-res transparent icon
    master_path = os.path.join(assets_dir, 'logo.png')
    rgba.save(master_path, format='PNG')
    print(f"Saved master icon to {master_path}")

    # Favicon PNG
    rgba.resize((64, 64), Image.Resampling.LANCZOS).save(os.path.join(public_dir, 'favicon.png'), format='PNG')

    # Apple Touch Icon 180x180
    rgba.resize((180, 180), Image.Resampling.LANCZOS).save(os.path.join(public_dir, 'apple-touch-icon.png'), format='PNG')

    # PWA 192x192
    rgba.resize((192, 192), Image.Resampling.LANCZOS).save(os.path.join(public_dir, 'pwa-192x192.png'), format='PNG')

    # PWA 512x512
    rgba.resize((512, 512), Image.Resampling.LANCZOS).save(os.path.join(public_dir, 'pwa-512x512.png'), format='PNG')

    # Favicon ICO with multiple sizes
    rgba.save(os.path.join(public_dir, 'favicon.ico'), format='ICO', sizes=[(16, 16), (32, 32), (48, 48)])

    # Maskable Icon 512x512 (with safe area margin)
    maskable = Image.new('RGBA', (512, 512), (10, 14, 23, 255)) # #0A0E17
    scaled_icon = rgba.resize((410, 410), Image.Resampling.LANCZOS)
    offset = (512 - 410) // 2
    maskable.paste(scaled_icon, (offset, offset), scaled_icon)
    maskable.save(os.path.join(public_dir, 'maskable-icon-512x512.png'), format='PNG')

    print("All PWA icons successfully generated in public/ directory!")

if __name__ == '__main__':
    process_logo()
