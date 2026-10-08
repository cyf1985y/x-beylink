"""Render new inference traces into annotated videos, mask evidence and a local report."""
import argparse, html, json, subprocess
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
import cv2

DOCS = Path(__file__).resolve().parent.parent
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--run', type=Path, required=True)
p.add_argument('--video', type=Path, required=True)
p.add_argument('--out', type=Path, required=True)
p.add_argument('--ffmpeg', default='ffmpeg')
p.add_argument('--skip-video', action='store_true')
a = p.parse_args()
run, out = a.run.resolve(), a.out.resolve()
if out == DOCS/'reports' or (out.exists() and any(out.iterdir())):
    p.error('Use a new empty output directory.')
out.mkdir(parents=True, exist_ok=True)
comparisons = {r['id']: r for r in json.loads((DOCS/'baseline/comparisons.json').read_text(encoding='utf-8'))}
cards = []
for summary in sorted(run.glob('*.summary.json')):
    metrics = json.loads(summary.read_text(encoding='utf-8'))
    job = metrics['job']
    if job['id'] not in comparisons:
        continue
    rows = [json.loads(line) for line in (run/f"{job['id']}.jsonl").read_text(encoding='utf-8').splitlines() if line]
    if not rows:
        continue
    calls = [r for r in rows if r['call']]
    first = calls[0] if calls else None
    media = ''
    if not a.skip_video:
        fps = 20
        decoder = subprocess.Popen([a.ffmpeg, '-v', 'error', '-ss', str(job['start']), '-i', str(a.video.resolve()),
            '-t', str(job['end']-job['start']), '-vf', 'fps=20,scale=480:480:flags=bilinear', '-f', 'rawvideo', '-pix_fmt', 'bgr24', 'pipe:1'], stdout=subprocess.PIPE)
        dest = out/f"{job['id']}_overlay.mp4"
        encoder = subprocess.Popen([a.ffmpeg, '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', '480x640', '-r', str(fps), '-i', 'pipe:0',
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(dest)], stdin=subprocess.PIPE)
        i, j = 0, 0
        try:
            while True:
                data = decoder.stdout.read(480*480*3)
                if not data:
                    break
                if len(data) != 480*480*3:
                    raise RuntimeError('Incomplete video frame')
                t = job['start']+i/fps
                while j+1 < len(rows) and rows[j+1]['t'] <= t+1e-6:
                    j += 1
                r = rows[j]
                canvas = np.zeros((640, 480, 3), np.uint8)
                canvas[:480] = np.frombuffer(data, np.uint8).reshape(480, 480, 3)
                for key, tr in r['tracks'].items():
                    if tr and tr['visible']:
                        pt = (round(tr['cx']), round(tr['cy'])); color = (255, 255, 0) if key == 'A' else (255, 0, 255)
                        cv2.circle(canvas, pt, round(tr['radius']), color, 2)
                        cv2.putText(canvas, key, (pt[0]-8, pt[1]-28), cv2.FONT_HERSHEY_SIMPLEX, .6, color, 2)
                current_calls = [c['call'] for c in calls if c['t'] <= t+1e-6]
                model = current_calls[-1]['result']+' loser='+str(current_calls[-1].get('loser_bey')) if current_calls else 'pending'
                labels = [f"Source {int(t//60):02d}:{t%60:05.2f} | state={r['state']}", f'MODEL: {model}', f"hand={r['obs']['hand']} changed={r['fg']:.1%}"]
                for key, tr in r['tracks'].items():
                    labels.append(f"{key}: seen={tr['visible']} spin={tr['spinning']} {tr['zone']}" if tr else key+': no track')
                labels.append('Compare with the annotated source events')
                for k, line in enumerate(labels):
                    cv2.putText(canvas, line, (10, 502+k*24), cv2.FONT_HERSHEY_SIMPLEX, .43, (230, 230, 230), 1, cv2.LINE_AA)
                encoder.stdin.write(canvas.tobytes()); i += 1
            decoder.stdout.close(); decoder.wait(); encoder.stdin.close(); encoder.wait()
            if decoder.returncode or encoder.returncode:
                raise RuntimeError('FFmpeg failed to render the overlay')
        finally:
            if decoder.poll() is None: decoder.kill()
            if encoder.poll() is None: encoder.kill()
        media += f'<video controls preload="metadata" src="{dest.name}"></video>'
    candidates = list((run/'frames').glob(f"{job['id']}_*.json"))
    if candidates:
        target = first['t'] if first else (job['start']+job['end'])/2
        chosen = min(candidates, key=lambda f: abs(float(f.stem.rsplit('_', 1)[1])-target))
        record = json.loads(chosen.read_text(encoding='utf-8'))
        source = Image.fromarray(np.frombuffer(chosen.with_suffix('.rgba').read_bytes(), np.uint8).reshape(480, 480, 4)).convert('RGB')
        mask = np.frombuffer(chosen.with_suffix('.mask').read_bytes(), np.uint8).reshape(480, 480)*255
        marked = source.copy(); draw = ImageDraw.Draw(marked)
        for blob in record['blobs']:
            b = blob['bbox']; color = {'bey':'lime','merged':'orange','hand':'red','discard':'gray'}[blob['cls']]
            draw.rectangle([b['x'], b['y'], b['x']+b['w'], b['y']+b['h']], outline=color, width=2)
        panel = Image.new('RGB', (1440, 515), '#101820'); draw = ImageDraw.Draw(panel)
        for k, (image, title) in enumerate([(source, f"Source {record['t']:.3f}s"), (Image.fromarray(mask).convert('RGB'), 'Program foreground'), (marked, 'Blob classification; red=hand')]):
            panel.paste(image, (480*k, 35)); draw.text((480*k+8, 8), title, fill='white')
        name = f"{job['id']}_evidence.png"; panel.save(out/name); media += f'<img src="{name}" alt="原始影格與前景遮罩">'
    human = comparisons[job['id']]
    decision = json.dumps(first['call'], ensure_ascii=False, indent=2) if first else '本次沒有產生判定'
    cards.append(f'<section><h2>{html.escape(job["id"])}</h2><p>本次首個判定：</p><pre>{html.escape(decision)}</pre><p>原始人工觀察（並非本次自動評分）：{html.escape(human["observed"])}</p>{media}</section>')
report = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>自動裁判重跑結果</title><style>body{font:16px/1.7 system-ui;margin:32px auto;max-width:1150px;padding:0 20px}section{border-top:1px solid #ddd;margin:25px 0;padding:15px 0}video{width:320px;max-width:100%}img{width:100%;margin-top:15px}pre{overflow:auto;background:#f3f5f7;padding:15px}</style><h1>自動裁判重跑結果</h1><p>請以逐格證據核對修正前後的判定，不將四段樣本換算成整片準確率。影片疊圖為 20 fps 顯示，原始輸入幀率見本次設定。</p>'+''.join(cards)
(out/'index.html').write_text(report, encoding='utf-8')
print('Rendered report:', out/'index.html')
