"""Regenerate temporal-median estimates; does not modify committed calibration."""
import argparse, gzip, hashlib, json, subprocess
from pathlib import Path
import numpy as np
from PIL import Image

DOCS = Path(__file__).resolve().parent.parent
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--video', type=Path, required=True)
p.add_argument('--out', type=Path, default=DOCS/'calibration-new')
p.add_argument('--ffmpeg', default='ffmpeg')
a = p.parse_args()
out = a.out.resolve()
if out == DOCS/'calibration' or (out.exists() and any(out.iterdir())):
    p.error('Use a new empty output directory; committed calibration is immutable.')
out.mkdir(parents=True, exist_ok=True)
manifest = []
for window in json.loads((DOCS/'config/background_windows.json').read_text(encoding='utf-8')):
    raw = subprocess.check_output([a.ffmpeg, '-v', 'error', '-ss', str(window['start']), '-i', str(a.video.resolve()),
        '-t', str(window['duration']), '-vf', f"fps={window['sample_fps']},scale=480:480:flags=bilinear",
        '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'])
    frames = np.frombuffer(raw, np.uint8).reshape(-1, 480, 480, 4)
    background = np.median(frames, axis=0).astype(np.uint8)
    data = background.tobytes()
    (out/f"{window['name']}.rgba.gz").write_bytes(gzip.compress(data, mtime=0))
    Image.fromarray(background).save(out/f"{window['name']}.png")
    manifest.append({**window, 'frames': len(frames), 'rgba_sha256': hashlib.sha256(data).hexdigest()})
    print(window['name'], len(frames), 'frames', flush=True)
(out/'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n', encoding='utf-8')
