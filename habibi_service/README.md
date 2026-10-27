# Habibi-TTS Iraqi Specialized worker

Real upstream model: https://github.com/SWivid/Habibi-TTS (`Specialized`, `IRQ`, `assets/IRQ.wav`).

Requires a Python 3.11 host (ideally GPU; a larger RAM budget), enough storage for the ~1.35 GB checkpoint and dependencies, plus a private API token.

```sh
pip install habibi-tts
export HABIBI_API_KEY='long-random-private-secret'
python server.py
```

Docker: build from `habibi_service/Dockerfile`. `ffmpeg` enables MP3 for single clips; the browser combines long recordings into WAV. The CLI reloads model weights for each segment, so this first implementation prioritizes correctness, not speed; running very long scripts may take time.

Node app environment:
```
HABIBI_URL=https://your-worker.example
HABIBI_API_KEY=long-random-private-secret
```
Keep key private server-side only. A deployment URL and real inference are **not** included by pushing code to GitHub. Google AI Studio preview alone does not run this model. Do not claim it is active unless the status reports configured and a real audio request succeeds.
