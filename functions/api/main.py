"""
main.py — REST API for the speed skating results database.

Public endpoints:
  GET /api/seasons
  GET /api/skaters?q=<name>
  GET /api/skaters/<code_pat>
  GET /api/skaters/<code_pat>/seasons/<season>
  GET /api/skaters/<code_pat>/results?season=&competition_id=
  GET /api/competitions?season=<s>
  GET /api/competitions/<id>/results

Admin endpoints (require Firebase ID token + admin_users entry):
  POST /api/admin/upload          multipart: file + track_type (ST|LT)
  GET  /api/admin/users           list admin emails
  POST /api/admin/users           body: {email}
  DELETE /api/admin/users/<email> remove admin
"""

import os
import re
import csv
import io
import hashlib
import secrets
import logging
from datetime import datetime, timedelta
from flask import Flask, jsonify, request, Response
from google.cloud import secretmanager
from google.cloud import storage as gcs_storage
from google.cloud.sql.connector import Connector
import sqlalchemy
from sqlalchemy import text
import firebase_admin
from firebase_admin import auth as fb_auth

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024  # 50 MB

PROJECT_ID = os.environ["GCP_PROJECT"]
INSTANCE_CONN_NAME = os.environ["CLOUD_SQL_INSTANCE"]
DB_NAME = os.environ.get("DB_NAME", "skate_results")
DB_USER = os.environ.get("DB_USER", "skate_app")
SECRET_NAME = os.environ.get("DB_SECRET", "skate-db-app-password")
GCS_BUCKET = os.environ.get("GCS_BUCKET", "sassa-odc-assets")

# Firebase Admin SDK — uses Application Default Credentials in Cloud Run
if not firebase_admin._apps:
    firebase_admin.initialize_app()


def _get_secret(secret_id: str) -> str:
    client = secretmanager.SecretManagerServiceClient()
    name = f"projects/{PROJECT_ID}/secrets/{secret_id}/versions/latest"
    return client.access_secret_version(request={"name": name}).payload.data.decode().strip()


_connector = Connector()
_db_pass = _get_secret(SECRET_NAME)


def _getconn():
    return _connector.connect(
        INSTANCE_CONN_NAME, "pg8000",
        user=DB_USER, password=_db_pass, db=DB_NAME,
    )


engine = sqlalchemy.create_engine(
    "postgresql+pg8000://",
    creator=_getconn,
    pool_size=5,
    max_overflow=2,
    pool_timeout=30,
)


@app.after_request
def add_cors(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type,Authorization"
    response.headers["Access-Control-Allow-Methods"] = "GET,POST,DELETE,OPTIONS"
    return response


# ── Auth helpers ──────────────────────────────────────────────────────────────

def _get_admin_email_if_any():
    """Return the caller's email if they hold a valid admin token, else None.

    Never raises — safe to call on any public endpoint to optionally elevate
    the response (e.g. include sensitive fields for admins).
    """
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None
    try:
        decoded = fb_auth.verify_id_token(auth_header[7:])
    except Exception:
        return None
    email = decoded.get("email", "").lower()
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT 1 FROM admin_users WHERE LOWER(email) = :email"),
            {"email": email},
        ).fetchone()
    return email if row else None


def _require_admin():
    """Verify Firebase token and admin_users membership.

    Returns (email, None) on success, or (None, flask_response) on failure.
    """
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None, (jsonify({"error": "Unauthorized"}), 401)
    token = auth_header[7:]
    try:
        decoded = fb_auth.verify_id_token(token)
    except Exception as e:
        log.warning("Token verification failed: %s", e)
        return None, (jsonify({"error": "Unauthorized"}), 401)

    email = decoded.get("email", "").lower()
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT 1 FROM admin_users WHERE LOWER(email) = :email"),
            {"email": email},
        ).fetchone()
    if not row:
        log.warning("Forbidden: %s not in admin_users", email)
        return None, (jsonify({"error": "Forbidden"}), 403)
    return email, None


# ── API key helpers ───────────────────────────────────────────────────────────

def _generate_api_key():
    """Return (raw_key, sha256_hex). Only raw_key is shown to the user; only
    the hash is stored in the database."""
    raw = "ssk_" + secrets.token_hex(32)
    key_hash = hashlib.sha256(raw.encode()).hexdigest()
    return raw, key_hash


def _require_api_key():
    """Validate an ApiKey token from the Authorization header.

    Returns (key_id, None) on success or (None, flask_response) on failure.
    """
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("ApiKey "):
        return None, (jsonify({"error": "Unauthorized"}), 401)
    raw_key = auth[7:]
    key_hash = hashlib.sha256(raw_key.encode()).hexdigest()
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT id FROM api_keys WHERE key_hash = :h AND expires_at > NOW()"),
            {"h": key_hash},
        ).fetchone()
    if not row:
        return None, (jsonify({"error": "Invalid or expired API key"}), 401)
    return row.id, None


# ── Admin endpoints ───────────────────────────────────────────────────────────

@app.route("/api/admin/upload", methods=["POST", "OPTIONS"])
def upload_pat():
    if request.method == "OPTIONS":
        return "", 204

    email, err = _require_admin()
    if err:
        return err

    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files["file"]
    track_type = request.form.get("track_type", "").upper()
    if track_type not in ("ST", "LT"):
        return jsonify({"error": "track_type must be ST or LT"}), 400

    original_name = file.filename or "upload.pat"
    if not original_name.lower().endswith(".pat"):
        return jsonify({"error": "File must have a .pat extension"}), 400

    safe_name = re.sub(r"[^\w\-.]", "_", original_name)
    gcs_path = f"uploads/{track_type}/{safe_name}"

    client = gcs_storage.Client()
    bucket = client.bucket(GCS_BUCKET)
    blob = bucket.blob(gcs_path)
    blob.upload_from_file(file.stream, content_type="application/octet-stream")

    log.info("Admin %s uploaded %s → gs://%s/%s", email, original_name, GCS_BUCKET, gcs_path)
    return jsonify({"queued": True, "path": gcs_path, "filename": original_name})


@app.route("/api/admin/users", methods=["GET", "OPTIONS"])
def get_admin_users():
    if request.method == "OPTIONS":
        return "", 204

    email, err = _require_admin()
    if err:
        return err

    with engine.connect() as conn:
        rows = conn.execute(
            text("SELECT email, added_at FROM admin_users ORDER BY added_at")
        ).fetchall()
    return jsonify([dict(r._mapping) for r in rows])


@app.route("/api/admin/users", methods=["POST"])
def add_admin_user():
    email, err = _require_admin()
    if err:
        return err

    body = request.get_json(silent=True) or {}
    new_email = body.get("email", "").strip().lower()
    if not new_email or "@" not in new_email:
        return jsonify({"error": "Valid email required"}), 400

    with engine.connect() as conn:
        conn.execute(
            text("INSERT INTO admin_users (email) VALUES (:email) ON CONFLICT DO NOTHING"),
            {"email": new_email},
        )
        conn.commit()
    return jsonify({"added": new_email})


@app.route("/api/admin/api-keys", methods=["GET", "OPTIONS"])
def list_api_keys():
    if request.method == "OPTIONS":
        return "", 204
    email, err = _require_admin()
    if err:
        return err
    with engine.connect() as conn:
        rows = conn.execute(text(
            "SELECT id, label, created_by, created_at, expires_at "
            "FROM api_keys WHERE expires_at > NOW() ORDER BY created_at DESC"
        )).fetchall()
    return jsonify([dict(r._mapping) for r in rows])


@app.route("/api/admin/api-keys", methods=["POST"])
def create_api_key():
    email, err = _require_admin()
    if err:
        return err
    body = request.get_json(silent=True) or {}
    label = body.get("label", "").strip() or None
    raw_key, key_hash = _generate_api_key()
    expires_at = datetime.utcnow() + timedelta(days=30)
    with engine.connect() as conn:
        row = conn.execute(text(
            "INSERT INTO api_keys (key_hash, label, created_by, expires_at) "
            "VALUES (:h, :label, :by, :exp) RETURNING id, created_at, expires_at"
        ), {"h": key_hash, "label": label, "by": email, "exp": expires_at}).fetchone()
        conn.commit()
    return jsonify({
        "id":         row.id,
        "key":        raw_key,
        "label":      label,
        "created_at": row.created_at.isoformat(),
        "expires_at": row.expires_at.isoformat(),
    })


@app.route("/api/admin/api-keys/<int:key_id>", methods=["DELETE", "OPTIONS"])
def revoke_api_key(key_id):
    if request.method == "OPTIONS":
        return "", 204
    email, err = _require_admin()
    if err:
        return err
    with engine.connect() as conn:
        conn.execute(text("DELETE FROM api_keys WHERE id = :id"), {"id": key_id})
        conn.commit()
    return jsonify({"revoked": key_id})


@app.route("/api/admin/users/<path:target_email>", methods=["DELETE", "OPTIONS"])
def remove_admin_user(target_email):
    if request.method == "OPTIONS":
        return "", 204

    email, err = _require_admin()
    if err:
        return err

    target = target_email.lower()
    if target == email:
        return jsonify({"error": "Cannot remove your own account"}), 400

    with engine.connect() as conn:
        conn.execute(
            text("DELETE FROM admin_users WHERE LOWER(email) = :email"),
            {"email": target},
        )
        conn.commit()
    return jsonify({"removed": target})


# ── Public endpoints ──────────────────────────────────────────────────────────

@app.route("/api/seasons")
def list_seasons():
    with engine.connect() as conn:
        rows = conn.execute(
            text("SELECT DISTINCT season FROM competitions ORDER BY season DESC")
        ).fetchall()
    return jsonify([r[0] for r in rows])


@app.route("/api/skaters")
def list_skaters():
    q = request.args.get("q", "").strip()
    with engine.connect() as conn:
        if q:
            rows = conn.execute(
                text(
                    "SELECT id, code_pat, first_name, last_name, club_name, club_abbrev "
                    "FROM skaters "
                    "WHERE LOWER(first_name || ' ' || last_name) LIKE LOWER(:q) "
                    "   OR LOWER(last_name || ' ' || first_name) LIKE LOWER(:q) "
                    "ORDER BY last_name, first_name LIMIT 50"
                ),
                {"q": f"%{q}%"},
            ).fetchall()
        else:
            rows = conn.execute(
                text(
                    "SELECT id, code_pat, first_name, last_name, club_name, club_abbrev "
                    "FROM skaters ORDER BY last_name, first_name LIMIT 500"
                )
            ).fetchall()
    return jsonify([dict(r._mapping) for r in rows])


@app.route("/api/skaters/<code_pat>")
def get_skater(code_pat):
    is_admin = _get_admin_email_if_any() is not None
    with engine.connect() as conn:
        skater = conn.execute(
            text("SELECT * FROM skaters WHERE code_pat = :cp"),
            {"cp": code_pat},
        ).fetchone()
        if not skater:
            return jsonify({"error": "Not found"}), 404

        best = conn.execute(
            text(
                "SELECT distance, track_type, best_time_ms, best_time_display, "
                "       achieved_on, achieved_at "
                "FROM best_times_career WHERE skater_id = :sid "
                "ORDER BY track_type, distance"
            ),
            {"sid": skater.id},
        ).fetchall()

    skater_dict = dict(skater._mapping)
    if not is_admin:
        skater_dict.pop("dob", None)
        skater_dict.pop("gender", None)
    return jsonify({
        "skater": skater_dict,
        "best_times": [dict(r._mapping) for r in best],
    })


@app.route("/api/skaters/<code_pat>/best-times")
def get_skater_best_times(code_pat):
    from_date = request.args.get("from", "").strip()
    to_date = request.args.get("to", "").strip()
    if not from_date or not to_date:
        return jsonify({"error": "from and to query params required"}), 400

    with engine.connect() as conn:
        skater = conn.execute(
            text("SELECT id FROM skaters WHERE code_pat = :cp"),
            {"cp": code_pat},
        ).fetchone()
        if not skater:
            return jsonify({"error": "Not found"}), 404

        best = conn.execute(
            text(
                """
                WITH ranked AS (
                  SELECT
                    REGEXP_REPLACE(r.distance, ' Round [A-Za-z0-9]+', '') AS distance,
                    c.track_type,
                    r.time_ms,
                    r.time_display,
                    c.date      AS achieved_on,
                    c.name      AS achieved_at,
                    ROW_NUMBER() OVER (
                      PARTITION BY REGEXP_REPLACE(r.distance, ' Round [A-Za-z0-9]+', ''),
                                   c.track_type
                      ORDER BY r.time_ms
                    ) AS rn
                  FROM results r
                  JOIN competitions c ON r.competition_id = c.id
                  WHERE r.skater_id    = :sid
                    AND r.is_valid_time = true
                    AND r.qual_or_fin   = 'Fin'
                    AND c.date BETWEEN :from_date AND :to_date
                )
                SELECT distance, track_type,
                       time_ms AS best_time_ms, time_display AS best_time_display,
                       achieved_on, achieved_at
                FROM ranked
                WHERE rn = 1
                ORDER BY track_type, distance
                """
            ),
            {"sid": skater.id, "from_date": from_date, "to_date": to_date},
        ).fetchall()

    return jsonify({"best_times": [dict(r._mapping) for r in best]})


@app.route("/api/skaters/<code_pat>/seasons/<season>")
def get_skater_season(code_pat, season):
    with engine.connect() as conn:
        skater = conn.execute(
            text("SELECT id FROM skaters WHERE code_pat = :cp"),
            {"cp": code_pat},
        ).fetchone()
        if not skater:
            return jsonify({"error": "Not found"}), 404

        best = conn.execute(
            text(
                "SELECT distance, track_type, season, best_time_ms, best_time_display, "
                "       achieved_on, achieved_at "
                "FROM best_times_by_season "
                "WHERE skater_id = :sid AND season = :season "
                "ORDER BY track_type, distance"
            ),
            {"sid": skater.id, "season": season},
        ).fetchall()

    return jsonify({"best_times": [dict(r._mapping) for r in best]})


@app.route("/api/skaters/<code_pat>/results")
def get_skater_results(code_pat):
    season = request.args.get("season")
    competition_id = request.args.get("competition_id")

    with engine.connect() as conn:
        skater = conn.execute(
            text("SELECT id FROM skaters WHERE code_pat = :cp"),
            {"cp": code_pat},
        ).fetchone()
        if not skater:
            return jsonify({"error": "Not found"}), 404

        where_parts = ["r.skater_id = :sid"]
        params = {"sid": skater.id}
        if season:
            where_parts.append("c.season = :season")
            params["season"] = season
        if competition_id:
            where_parts.append("c.id = :cid")
            params["cid"] = int(competition_id)

        where = " AND ".join(where_parts)
        rows = conn.execute(
            text(
                f"""
                SELECT
                    r.id, r.distance, r.qual_or_fin, r.heat,
                    r.time_ms, r.time_display, r.place, r.age_class,
                    r.finish_code, r.points, r.is_valid_time,
                    c.id AS competition_id, c.name AS competition_name,
                    c.date AS competition_date, c.season, c.track_type
                FROM results r
                JOIN competitions c ON r.competition_id = c.id
                WHERE {where}
                ORDER BY c.date DESC, r.distance, r.qual_or_fin, r.heat
                """
            ),
            params,
        ).fetchall()

    return jsonify({"results": [dict(r._mapping) for r in rows]})


@app.route("/api/competitions")
def list_competitions():
    season = request.args.get("season")
    with engine.connect() as conn:
        if season:
            rows = conn.execute(
                text(
                    "SELECT id, name, date, season, track_type FROM competitions "
                    "WHERE season = :s ORDER BY date DESC"
                ),
                {"s": season},
            ).fetchall()
        else:
            rows = conn.execute(
                text(
                    "SELECT id, name, date, season, track_type "
                    "FROM competitions ORDER BY date DESC"
                )
            ).fetchall()
    return jsonify([dict(r._mapping) for r in rows])


@app.route("/api/competitions/<int:comp_id>/results")
def get_competition_results(comp_id):
    is_admin = _get_admin_email_if_any() is not None
    with engine.connect() as conn:
        comp = conn.execute(
            text("SELECT * FROM competitions WHERE id = :id"),
            {"id": comp_id},
        ).fetchone()
        if not comp:
            return jsonify({"error": "Not found"}), 404

        rows = conn.execute(
            text(
                """
                SELECT
                    r.id, r.distance, r.qual_or_fin, r.heat, r.lane,
                    r.time_ms, r.time_display, r.place, r.age_class,
                    r.finish_code, r.points, r.is_valid_time, r.group_name,
                    s.code_pat, s.first_name, s.last_name,
                    s.club_name, s.club_abbrev, s.gender
                FROM results r
                JOIN skaters s ON r.skater_id = s.id
                WHERE r.competition_id = :cid
                ORDER BY r.age_class, s.last_name, s.first_name,
                         r.distance, r.qual_or_fin, r.heat
                """
            ),
            {"cid": comp_id},
        ).fetchall()

    results = [dict(r._mapping) for r in rows]
    if not is_admin:
        for row in results:
            row.pop("gender", None)
    return jsonify({
        "competition": dict(comp._mapping),
        "results": results,
    })


# ── Batch endpoint (API key auth) ─────────────────────────────────────────────

@app.route("/api/batch/best-times", methods=["POST", "OPTIONS"])
def batch_best_times():
    if request.method == "OPTIONS":
        return "", 204

    _, err = _require_api_key()
    if err:
        return err

    from_date = request.args.get("from", "").strip()
    to_date   = request.args.get("to",   "").strip()
    if not from_date or not to_date:
        return jsonify({"error": "from and to query params required"}), 400

    raw_csv = request.get_data(as_text=True)
    reader  = csv.DictReader(io.StringIO(raw_csv))
    if not {"ssc_id", "name"}.issubset(set(reader.fieldnames or [])):
        return jsonify({"error": "CSV must have ssc_id and name columns"}), 400

    input_rows = [
        {"ssc_id": r["ssc_id"].strip(), "name": r["name"].strip()}
        for r in reader
        if r.get("ssc_id", "").strip()
    ]
    if not input_rows:
        return jsonify({"error": "No rows in CSV"}), 400

    ssc_ids    = [r["ssc_id"] for r in input_rows]
    name_by_id = {r["ssc_id"]: r["name"] for r in input_rows}

    # Build numbered IN-list params (works with SQLAlchemy text() + pg8000)
    in_params   = {f"id{i}": v for i, v in enumerate(ssc_ids)}
    in_clause   = ", ".join(f":id{i}" for i in range(len(ssc_ids)))

    with engine.connect() as conn:
        skaters = conn.execute(
            text(f"SELECT id, code_pat, club_name FROM skaters WHERE code_pat IN ({in_clause})"),
            in_params,
        ).fetchall()

        found = {s.code_pat: s for s in skaters}

        if found:
            result_params = {**in_params, "from_date": from_date, "to_date": to_date}
            pb_rows = conn.execute(text(f"""
                WITH ranked AS (
                  SELECT
                    s.code_pat,
                    REGEXP_REPLACE(r.distance, ' Round [A-Za-z0-9]+', '') AS distance,
                    c.track_type,
                    r.time_ms,
                    r.time_display,
                    c.date AS achieved_on,
                    c.name AS achieved_at,
                    ROW_NUMBER() OVER (
                      PARTITION BY s.code_pat,
                                   REGEXP_REPLACE(r.distance, ' Round [A-Za-z0-9]+', ''),
                                   c.track_type
                      ORDER BY r.time_ms
                    ) AS rn
                  FROM results r
                  JOIN competitions c ON r.competition_id = c.id
                  JOIN skaters s ON r.skater_id = s.id
                  WHERE s.code_pat IN ({in_clause})
                    AND r.is_valid_time = true
                    AND r.qual_or_fin = 'Fin'
                    AND c.date BETWEEN :from_date AND :to_date
                )
                SELECT code_pat, distance, track_type,
                       time_display AS best_time, achieved_at, achieved_on
                FROM ranked WHERE rn = 1
                ORDER BY code_pat, track_type, distance
            """), result_params).fetchall()
        else:
            pb_rows = []

    pbs_by_id = {}
    for r in pb_rows:
        pbs_by_id.setdefault(r.code_pat, []).append(r)

    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["ssc_id", "name", "club", "track_type", "distance",
                     "best_time", "achieved_at", "achieved_on"])

    for inp in input_rows:
        sid    = inp["ssc_id"]
        name   = inp["name"]
        skater = found.get(sid)
        rows   = pbs_by_id.get(sid, [])

        if not skater or not rows:
            writer.writerow([sid, name, "", "", "", "", "", ""])
        else:
            for r in rows:
                writer.writerow([
                    sid, name, skater.club_name or "",
                    r.track_type, r.distance, r.best_time or "",
                    r.achieved_at or "",
                    r.achieved_on.isoformat() if r.achieved_on else "",
                ])

    filename = f"best-times-{from_date}-to-{to_date}.csv"
    return Response(
        out.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8080)), debug=False)
