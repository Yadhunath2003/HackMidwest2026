FROM python:3.12-slim

WORKDIR /app

# Dependencies first so this layer is cached until requirements.txt changes.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

EXPOSE 8000
# Import the extended BTC/USD history on first start (skipped once cached), then serve.
CMD ["sh", "-c", "python -m app.ensure_history; exec uvicorn app.main:app --host 0.0.0.0 --port 8000"]
