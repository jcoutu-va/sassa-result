"""
main.py — Cloud Function entry point.

Triggered by a Cloud Storage finalize event when a .pat file is uploaded to:
  gs://<bucket>/uploads/ST/<filename>.pat
  gs://<bucket>/uploads/LT/<filename>.pat

The ST/LT path segment determines the track type.
"""

import os
import logging
import tempfile

import functions_framework
from cloudevents.http import CloudEvent
from google.cloud import secretmanager, storage

from extractor import extract
from loader import load

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

PROJECT_ID             = os.environ["GCP_PROJECT"]
INSTANCE_CONN_NAME     = os.environ["CLOUD_SQL_INSTANCE"]   # project:region:instance
DB_NAME                = os.environ.get("DB_NAME", "skate_results")
DB_USER                = os.environ.get("DB_USER", "skate_app")
SECRET_NAME            = os.environ.get("DB_SECRET", "skate-db-app-password")


def _get_secret(secret_id: str) -> str:
    client = secretmanager.SecretManagerServiceClient()
    name = f"projects/{PROJECT_ID}/secrets/{secret_id}/versions/latest"
    return client.access_secret_version(request={"name": name}).payload.data.decode().strip()


@functions_framework.cloud_event
def process_pat(event: CloudEvent) -> None:
    data = event.data
    bucket_name = data["bucket"]
    object_path = data["name"]   # e.g. "uploads/LT/jslt_2026.pat"

    log.info("Triggered: gs://%s/%s", bucket_name, object_path)

    # Only process .pat files under uploads/
    if not object_path.endswith(".pat") or not object_path.startswith("uploads/"):
        log.info("Skipping non-PAT or non-upload path: %s", object_path)
        return

    # Derive track type from path: uploads/ST/... or uploads/LT/...
    parts = object_path.split("/")
    if len(parts) < 3 or parts[1].upper() not in ("ST", "LT"):
        log.error("Cannot determine track type from path: %s", object_path)
        return
    track_type = parts[1].upper()

    # Download PAT file to temp storage
    gcs = storage.Client()
    bucket = gcs.bucket(bucket_name)
    blob = bucket.blob(object_path)

    with tempfile.NamedTemporaryFile(suffix=".pat", delete=False) as tmp:
        tmp_path = tmp.name
        blob.download_to_filename(tmp_path)
        log.info("Downloaded to %s (%d bytes)", tmp_path, os.path.getsize(tmp_path))

    try:
        # Extract
        log.info("Extracting PAT file (track_type=%s)...", track_type)
        data_out = extract(tmp_path, track_type)
        comp = data_out["competition"]
        log.info(
            "Extracted: %s | %s | %d results (%d skaters)",
            comp["name"], comp["date"],
            len(data_out["results"]), len(data_out["skaters"]),
        )

        # Load into Cloud SQL
        db_pass = _get_secret(SECRET_NAME)
        summary = load(
            data_out,
            instance_connection_name=INSTANCE_CONN_NAME,
            db_user=DB_USER,
            db_pass=db_pass,
            db_name=DB_NAME,
        )
        log.info("Loaded: %s", summary)

    finally:
        os.unlink(tmp_path)
