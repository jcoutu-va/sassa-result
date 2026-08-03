FROM python:3.11-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends mdbtools \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV PORT=8080
CMD exec functions-framework --target=process_pat --signature-type=cloudevent --port=$PORT
