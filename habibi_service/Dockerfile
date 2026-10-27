# Optional heavy-duty service; consider GPU hosting for acceptable latency.
FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libsndfile1 git && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN pip install --no-cache-dir habibi-tts
COPY server.py /app/server.py
ENV PORT=7860
EXPOSE 7860
CMD ["python", "server.py"]
