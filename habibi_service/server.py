"""Optional separate Habibi-TTS Specialized/IRQ worker for Sawtak v4.

Runs upstream official habibi-tts_infer-cli as a child process; requires Python,
PyTorch, ffmpeg (optional), sufficient memory and model downloads on first run.
"""
import json
import os
import shutil
import subprocess
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HOST = os.environ.get('HOST', '0.0.0.0')
PORT = int(os.environ.get('PORT', '7860'))
TOKEN = os.environ.get('HABIBI_API_KEY', '')
MAX_TEXT = 850
REF_TEXT = 'يعني ااا ما نقدر ناخذ وقت أكثر، ااا لأنه شروط كلش يحتاجلها وقت.'
BUSY = threading.Semaphore(1)

class Handler(BaseHTTPRequestHandler):
    def write(self, status, data, mime='application/json; charset=utf-8'):
        if isinstance(data, (dict, list)):
            data = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == '/health':
            self.write(200, {'ok': True, 'model': 'Habibi-TTS Specialized/IRQ', 'mode': 'Python worker'})
        else:
            self.write(404, {'error': 'Not found'})

    def do_POST(self):
        if self.path != '/generate':
            return self.write(404, {'error': 'Not found'})
        if not TOKEN:
            return self.write(503, {'error': 'Set HABIBI_API_KEY on the Python worker.'})
        if self.headers.get('Authorization') != 'Bearer ' + TOKEN:
            return self.write(401, {'error': 'Unauthorized'})
        if not self.headers.get('Content-Type', '').startswith('application/json'):
            return self.write(415, {'error': 'JSON required'})
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if length < 2 or length > 12000:
                return self.write(413, {'error': 'Payload too large'})
            payload = json.loads(self.rfile.read(length))
            text = str(payload.get('text', '')).strip()
            speed = float(payload.get('speed', 1))
            if not text or len(text) > MAX_TEXT or not 0.7 <= speed <= 1.3:
                return self.write(400, {'error': 'Invalid text or speed'})
        except (ValueError, TypeError, json.JSONDecodeError):
            return self.write(400, {'error': 'Bad input'})

        if not BUSY.acquire(blocking=False):
            return self.write(429, {'error': 'Habibi is busy with another request'})
        try:
            with tempfile.TemporaryDirectory(prefix='sawtak_irq_') as work:
                work = Path(work)
                text_path = work / 'text.txt'
                text_path.write_text(text, encoding='utf-8')
                command = [
                    'habibi-tts_infer-cli', '--model', 'Specialized',
                    '--dialect', 'IRQ', '--ref_audio', 'assets/IRQ.wav',
                    '--ref_text', REF_TEXT, '--gen_file', str(text_path),
                    '--output_dir', str(work), '--output_file', 'voice.wav',
                    '--speed', str(speed),
                ]
                completed = subprocess.run(command, capture_output=True, text=True,
                                           encoding='utf-8', errors='replace', timeout=260)
                if completed.returncode != 0:
                    print('Habibi model error:', completed.stderr[-1200:], flush=True)
                    return self.write(502, {'error': 'Habibi inference failed; check worker logs and model installation.'})
                wav = work / 'voice.wav'
                if not wav.is_file() or wav.stat().st_size < 44 or wav.open('rb').read(4) != b'RIFF':
                    return self.write(502, {'error': 'Habibi did not produce a valid WAV file.'})
                if shutil.which('ffmpeg'):
                    mp3 = work / 'voice.mp3'
                    encode = subprocess.run(['ffmpeg', '-nostdin', '-loglevel', 'error', '-y',
                         '-i', str(wav), '-codec:a', 'libmp3lame', '-b:a', '128k', str(mp3)],
                         capture_output=True, timeout=30)
                    if encode.returncode == 0 and mp3.exists() and mp3.stat().st_size > 128:
                        return self.write(200, mp3.read_bytes(), 'audio/mpeg')
                self.write(200, wav.read_bytes(), 'audio/wav')
        except subprocess.TimeoutExpired:
            self.write(504, {'error': 'Habibi took too long. Check server resources.'})
        except FileNotFoundError:
            self.write(503, {'error': 'Install package: pip install habibi-tts'})
        except Exception as exc:
            print('Worker failure:', repr(exc), flush=True)
            self.write(500, {'error': 'Habibi worker failed; check logs.'})
        finally:
            BUSY.release()

if __name__ == '__main__':
    if not TOKEN:
        print('WARNING: HABIBI_API_KEY must be set before /generate is usable.', flush=True)
    print(f'Habibi IRQ worker listening on {HOST}:{PORT}', flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
