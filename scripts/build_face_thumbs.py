"""
64px thumbnails of the player photographs, for list-sized faces in player mode.

A lineup draws a face at 18-30px. The dossier photos are 192px (about 7.5 KB
each); a 64px thumbnail covers a 32px face on a 2x screen at under 1 KB, so a
match screen with ten faces costs a phone ~9 KB instead of ~75 KB.

Reads src/data/dossier.json for the files players actually use, writes
public/faces/s/<same name>.webp, and removes thumbnails nobody uses any more.
Run it after the face fetchers / build_dossier.py. ui/me/Face.tsx falls back
to the full photo when a thumbnail is missing, so a stale run is never a
broken image.
"""
import json
import os

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'public', 'faces')
OUT = os.path.join(SRC, 's')
SIZE = 64


def main() -> None:
    with open(os.path.join(ROOT, 'src', 'data', 'dossier.json'), encoding='utf-8') as fh:
        dossier = json.load(fh)
    files = sorted({p['img'] for p in dossier['players'].values() if p.get('img')})
    os.makedirs(OUT, exist_ok=True)
    total = 0
    made = 0
    for name in files:
        src = os.path.join(SRC, name)
        if not os.path.exists(src):
            continue
        im = Image.open(src)
        # keep transparency only where a photo actually has some: an opaque alpha plane doubles the bytes
        clear = 'A' in im.getbands() and im.getchannel('A').getextrema()[0] < 250
        im = im.convert('RGBA' if clear else 'RGB')
        w, h = im.size
        side = min(w, h)
        left = (w - side) // 2
        # a tall portrait keeps its head: crop from the top
        top = 0 if h > w else (h - side) // 2
        im = im.crop((left, top, left + side, top + side)).resize((SIZE, SIZE), Image.LANCZOS)
        dst = os.path.join(OUT, name)
        im.save(dst, 'WEBP', quality=74, method=6)
        total += os.path.getsize(dst)
        made += 1
    keep = set(files)
    for name in os.listdir(OUT):
        if name not in keep:
            os.remove(os.path.join(OUT, name))
    print(f'{made} thumbnails, {total // 1024} KB, in public/faces/s')


if __name__ == '__main__':
    main()
