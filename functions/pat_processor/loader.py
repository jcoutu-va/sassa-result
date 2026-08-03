"""
loader.py — Upsert extracted PAT data into Cloud SQL (PostgreSQL).

Multiple PAT files may contain data for the same competition (e.g. a partial
export followed by a complete one). Results are merged row-by-row using
ON CONFLICT DO UPDATE so no previously-loaded result is ever deleted by a
subsequent upload. The unique key for a result is
(competition_id, skater_id, distance, heat).
"""

import logging
from google.cloud.sql.connector import Connector

log = logging.getLogger(__name__)


def load(data: dict, instance_connection_name: str,
         db_user: str, db_pass: str, db_name: str) -> dict:
    """Upsert competition, skaters, and results into Cloud SQL."""
    connector = Connector()
    conn = connector.connect(
        instance_connection_name,
        "pg8000",
        user=db_user,
        password=db_pass,
        db=db_name,
    )

    try:
        cur = conn.cursor()
        comp = data["competition"]

        # --- Check whether this competition already exists ---
        cur.execute(
            "SELECT id FROM competitions WHERE name = %s AND date = %s",
            (comp["name"], comp["date"]),
        )
        existing = cur.fetchone()
        is_update = existing is not None
        if is_update:
            log.info("Competition already exists (id=%s) — merging results", existing[0])

        # --- Upsert competition ---
        cur.execute(
            """
            INSERT INTO competitions (name, date, season, track_type)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (name, date) DO UPDATE
                SET season      = EXCLUDED.season,
                    track_type  = EXCLUDED.track_type,
                    imported_at = NOW()
            RETURNING id
            """,
            (comp["name"], comp["date"], comp["season"], comp["track_type"]),
        )
        competition_id = cur.fetchone()[0]

        # --- Upsert skaters ---
        for s in data["skaters"]:
            cur.execute(
                """
                INSERT INTO skaters
                    (code_pat, first_name, last_name, dob, gender, club_name, club_abbrev)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (code_pat) DO UPDATE SET
                    first_name  = EXCLUDED.first_name,
                    last_name   = EXCLUDED.last_name,
                    dob         = COALESCE(EXCLUDED.dob, skaters.dob),
                    gender      = COALESCE(EXCLUDED.gender, skaters.gender),
                    club_name   = EXCLUDED.club_name,
                    club_abbrev = EXCLUDED.club_abbrev,
                    updated_at  = NOW()
                """,
                (s["code_pat"], s["first_name"], s["last_name"],
                 s["dob"], s["gender"], s["club_name"], s["club_abbrev"]),
            )

        # Build skater code_pat -> db id lookup
        cur.execute("SELECT id, code_pat FROM skaters")
        skater_id_map = {row[1]: row[0] for row in cur.fetchall()}

        # --- Upsert results (merge, never delete) ---
        # Unique key: (competition_id, skater_id, distance, heat)
        inserted = 0
        updated = 0
        skipped = 0
        for r in data["results"]:
            skater_db_id = skater_id_map.get(r["skater_id"])
            if skater_db_id is None:
                skipped += 1
                continue
            cur.execute(
                """
                INSERT INTO results
                    (competition_id, skater_id, distance, qual_or_fin, heat, lane,
                     time_ms, time_display, place, age_class, finish_code,
                     points, is_valid_time, group_name)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (competition_id, skater_id, distance, heat) DO UPDATE SET
                    qual_or_fin  = EXCLUDED.qual_or_fin,
                    lane         = EXCLUDED.lane,
                    time_ms      = EXCLUDED.time_ms,
                    time_display = EXCLUDED.time_display,
                    place        = EXCLUDED.place,
                    age_class    = EXCLUDED.age_class,
                    finish_code  = EXCLUDED.finish_code,
                    points       = EXCLUDED.points,
                    is_valid_time = EXCLUDED.is_valid_time,
                    group_name   = EXCLUDED.group_name
                """,
                (competition_id, skater_db_id,
                 r["distance"], r["qual_or_fin"], r["heat"], r["lane"],
                 r["time_ms"], r["time_display"], r["place"], r["age_class"],
                 r["finish_code"], r["points"], r["is_valid_time"],
                 r.get("group_name")),
            )
            # rowcount == 1 for both INSERT and UPDATE in pg8000
            # We track is_update flag from the competition check to distinguish new vs merge
            if is_update:
                updated += 1
            else:
                inserted += 1

        conn.commit()
        cur.close()
        return {
            "competition_id": competition_id,
            "is_update": is_update,
            "skaters_upserted": len(data["skaters"]),
            "results_inserted": inserted,
            "results_merged": updated,
            "results_skipped": skipped,
        }

    finally:
        conn.close()
        connector.close()
