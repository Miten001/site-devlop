FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# data/ ko volume me mount karna (persist DB): docker run -v flexfam_data:/app/data ...
VOLUME ["/app/data"]

ENV PYTHONUNBUFFERED=1

CMD ["python", "bot.py"]
