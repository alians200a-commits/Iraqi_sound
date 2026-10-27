# Habibi IRQ worker (optional)

Runs the real **SWivid/Habibi-TTS** **Specialized/IRQ** model, not a simulated voice. This is NOT part of the default lightweight Node container. First use downloads ~1.35 GB specialized checkpoint plus model dependencies; Python/PyTorch requires significant memory and benefits from GPU.

## On a Python machine or supported hosting

```bash
python -m venv .venv
source .venv/bin/activate
pip install habibi-tts
# Install ffmpeg to receive MP3. Without ffmpeg the worker returns WAV.
export HABIBI_API_KEY='CHOOSE_A_LONG_PRIVATE_SECRET'
python server.py
```

On Windows replace `source .venv/bin/activate` with `.venv\\Scripts\\activate` and use the appropriate environment-variable command.

For production, deploy this folder as a separate Python service (Dockerfile included) with adequate disk/RAM/GPU and HTTPS. Configure on the *Node.js app*:

```
HABIBI_URL=https://your-private-habibi-worker.example
HABIBI_API_KEY=the-same-private-secret
```

Keep both secrets as server-side environment variables (never in HTML or GitHub). Worker exposes `GET /health` and private `POST /generate`. **Do not expose an unauthenticated inference service publicly.**

Reference audio `assets/IRQ.wav` and its matching transcript are bundled by the upstream `habibi-tts` package and used by CLI. Checkpoint auto-download: `SWivid/Habibi-TTS/Specialized/IRQ/model_100000.safetensors` (Apache 2.0). No checkpoint weights are committed to this repository.

The UI only enables Habibi if `HABIBI_URL` is configured on the Node server. **Google AI Studio Preview alone does not run this full ML worker**; a separate Python inference host is needed. Deployment, latency, and resource expenses depend on the selected provider.
