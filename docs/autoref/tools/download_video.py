"""Optional download of the documented public test video; no cookies or login used."""
import argparse, hashlib, shutil
from pathlib import Path
import yt_dlp

DOCS = Path(__file__).resolve().parent.parent
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--out', type=Path, default=DOCS/'data')
a = p.parse_args()
a.out.mkdir(parents=True, exist_ok=True)
opts = {'format': '398/bv*[height<=720]/b[height<=720]', 'outtmpl': str(a.out/'%(id)s.%(ext)s'), 'noplaylist': True,
        'socket_timeout': 25, 'retries': 2, 'writeinfojson': False}
node = shutil.which('node')
if node:
    opts['js_runtimes'] = {'node': {'path': node}}
with yt_dlp.YoutubeDL(opts) as ydl:
    info = ydl.extract_info('https://www.youtube.com/watch?v=oXBdn4yQYog', download=True)
    file = Path(ydl.prepare_filename(info))
actual = hashlib.sha256(file.read_bytes()).hexdigest()
expected = 'c82097e4e7b4ae48601a09c39f8c52f74c553795fac62670f58a1290c8611ad8'
print('File:', file)
print('SHA-256:', actual)
print('Matches original input:', actual == expected)
if actual != expected:
    print('YouTube formats may change. This is not a byte-identical input; recalibration or explicit --allow-different-video is required.')
