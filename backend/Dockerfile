FROM python:3.11-slim

# System dependencies: Tesseract OCR + Poppler (pdf2image) + Ghostscript (ocrmypdf)
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    tesseract-ocr-eng \
    tesseract-ocr-osd \
    tesseract-ocr-hin \
    tesseract-ocr-ben \
    tesseract-ocr-asm \
    poppler-utils \
    ghostscript \
    libgl1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]
