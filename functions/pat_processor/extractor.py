"""
extractor.py — Read a GCPV .pat (MDB) file using mdbtools and return
structured result rows ready for database loading.
"""

import csv
import io
import logging
import subprocess
from datetime import date, datetime

log = logging.getLogger(__name__)


def _export_table(pat_path: str, table: str) -> list[dict]:
    """Run mdb-export and return rows as a list of dicts."""
    result = subprocess.run(
        ["mdb-export", pat_path, table],
        capture_output=True, text=True, timeout=60
    )
    if result.returncode != 0:
        raise RuntimeError(f"mdb-export failed on {table}: {result.stderr.strip()}")
    reader = csv.DictReader(io.StringIO(result.stdout))
    return list(reader)


def _decode_time(raw: str):
    """Convert GCPV Temps string to (time_ms: int, display: str) or (None, None).

    GCPV stores time as a float where:
      integer part = minutes
      fractional part * 100 = seconds + hundredths
    e.g. "1.5357" -> 1 min 53.57 sec = 113570 ms
    """
    try:
        val = float(raw)
    except (TypeError, ValueError):
        return None, None
    if val <= 0:
        return None, None
    minutes = int(val)
    seconds = round((val - minutes) * 100, 3)
    total_ms = round((minutes * 60 + seconds) * 1000)
    display = f"{minutes}:{seconds:05.2f}" if minutes > 0 else f"{seconds:.2f}"
    return total_ms, display


def _parse_date(raw: str) -> date | None:
    """Parse date strings from mdb-export.

    mdb-export on Linux outputs dates in various formats depending on locale
    and mdbtools version, e.g.:
      "12/31/2025 00:00:00"  "2025-12-31 00:00:00"  "12/31/2025"
    """
    if not raw:
        return None
    raw = raw.strip().strip('"')
    # Try without time component first, then with
    for fmt in (
        "%m/%d/%y %H:%M:%S",
        "%m/%d/%Y %H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
        "%m/%d/%Y",
        "%m/%d/%y",
        "%Y-%m-%d",
        "%d/%m/%Y",
    ):
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    return None


def _derive_season(d: date) -> str:
    """Oct-Dec -> season starting that year; Jan-Sep -> season starting prior year."""
    if d.month >= 10:
        return f"{d.year}-{d.year + 1}"
    return f"{d.year - 1}-{d.year}"


VALID_FINISH_ABBREVS = {".", "", None}


def extract(pat_path: str, track_type: str) -> dict:
    """Extract all results from a PAT file.

    Returns:
        {
          "competition": { name, date, season, track_type },
          "skaters":     [ { code_pat, first_name, last_name, dob, gender, club_name, club_abbrev } ],
          "results":     [ { skater_id (code_pat), distance, qual_or_fin, heat, lane,
                             time_ms, time_display, place, age_class, finish_code,
                             points, is_valid_time } ]
        }
    """
    # --- Load all needed tables ---
    raw_comp      = _export_table(pat_path, "TCompetition")
    raw_skaters   = _export_table(pat_path, "TPatineurs")
    raw_cats      = _export_table(pat_path, "TCategorie")
    raw_clubs     = _export_table(pat_path, "TClubs")
    raw_patcomp   = _export_table(pat_path, "TPatineur_compe")
    raw_patvagues = _export_table(pat_path, "TPatVagues")
    raw_vagues    = _export_table(pat_path, "TVagues")
    raw_prog      = _export_table(pat_path, "TProg_Courses")
    raw_comment   = _export_table(pat_path, "TCommentaire")

    # --- Resolve active competition ---
    # GCPV seeds each new PAT from the previous event's file, so TCompetition may
    # contain multiple rows (historical carry-forward). The active competition is the
    # one with the most entries in TPatineur_compe — that's where skaters were registered.
    if not raw_comp:
        raise ValueError("No competition found in PAT file")

    if len(raw_comp) == 1:
        comp_row = raw_comp[0]
    else:
        from collections import Counter
        entries_per_comp = Counter(r["NoCompetition"] for r in raw_patcomp)

        # Competitions with meaningful registrations (≥5 skaters).
        # GCPV seeds each new PAT from the prior event, carrying forward all
        # previous skaters, so older competitions always have more entries.
        # Among non-empty competitions, the latest by date is always the active
        # one — use date as the tiebreaker rather than entry count.
        non_empty = [c for c in raw_comp if entries_per_comp.get(c["NoCompetition"], 0) >= 5]
        pool = non_empty if non_empty else raw_comp

        def _comp_sort_key(c):
            d = _parse_date(c.get("Date", ""))
            # Primary: latest date. Secondary: most entries (breaks same-day ties,
            # e.g. a main meet alongside a small qualifier in the same PAT file).
            return (d if d else date.min, entries_per_comp.get(c["NoCompetition"], 0))

        comp_row = max(pool, key=_comp_sort_key)
        log.info(
            "Multiple TCompetition rows (%d); selected NoCompetition=%s (%s, %s) with %d entries",
            len(raw_comp), comp_row["NoCompetition"], comp_row["Lieu"],
            comp_row.get("Date", ""), entries_per_comp.get(comp_row["NoCompetition"], 0),
        )

    active_comp_id = comp_row["NoCompetition"]

    # --- Build lookup dictionaries (patcomp scoped to the active competition) ---
    skater_by_id  = {r["NoPatineur"]: r for r in raw_skaters}
    cat_by_id     = {r["NoCategorie"]: r for r in raw_cats}
    club_by_id    = {r["NoClub"]: r for r in raw_clubs}
    patcomp_by_id = {
        r["NoPatCompe"]: r for r in raw_patcomp
        if r["NoCompetition"] == active_comp_id
    }
    vague_by_cle  = {r["CleTVagues"]: r for r in raw_vagues}
    prog_by_cle   = {r["CleDistancesCompe"]: r for r in raw_prog}
    comment_by_code = {r["Code"]: r for r in raw_comment}
    comp_date = _parse_date(comp_row.get("Date", ""))
    if comp_date is None:
        raise ValueError(f"Could not parse competition date from: {comp_row.get('Date')!r}")
    competition = {
        "name":       comp_row["Lieu"],
        "date":       comp_date.isoformat(),
        "season":     _derive_season(comp_date),
        "track_type": track_type,
    }

    # --- Join and build result rows ---
    skaters_seen: dict[str, dict] = {}
    results = []

    for pv in raw_patvagues:
        pc = patcomp_by_id.get(pv["NoPatCompe"])
        if not pc:
            continue
        skater = skater_by_id.get(pc["NoPatineur"])
        cat    = cat_by_id.get(pc["NoCategorie"])
        club   = club_by_id.get(pc["NoClub"])
        vague  = vague_by_cle.get(pv["CleTVagues"])
        prog   = prog_by_cle.get(vague["CleDistancesCompe"]) if vague else None

        if not all([skater, vague, prog]):
            continue

        code_pat = skater["CodePat"].strip()
        dob = _parse_date(skater.get("Date de naissance", ""))

        if code_pat not in skaters_seen:
            club_name   = club["Nom du Club"].strip() if club else ""
            club_abbrev = club["Abreviation"].strip() if club else ""
            skaters_seen[code_pat] = {
                "code_pat":   code_pat,
                "first_name": skater["Prenom"].strip(),
                "last_name":  skater["Nom"].strip(),
                "dob":        dob.isoformat() if dob else None,
                "gender":     skater.get("Sexe", "").strip() or None,
                "club_name":  club_name,
                "club_abbrev": club_abbrev,
            }

        com = comment_by_code.get(pv["Juge"])
        finish_code = com["Abreviation"].strip() if com else None
        if finish_code in VALID_FINISH_ABBREVS:
            finish_code = None

        time_ms, time_display = _decode_time(pv.get("Temps"))
        is_valid = finish_code is None and time_ms is not None

        try:
            place = int(pv["Rang"]) if pv.get("Rang") else None
        except ValueError:
            place = None

        try:
            points = float(pv["Point"]) if pv.get("Point") else None
        except ValueError:
            points = None

        group_name = pc.get("Groupe", "").strip() or None

        results.append({
            "skater_id":    code_pat,
            "distance":     prog["Distance"].strip(),
            "qual_or_fin":  vague["Qual_ou_Fin"].strip(),
            "heat":         vague["NoVague"].strip(),
            "lane":         pv.get("NoCasque", "").strip() or None,
            "time_ms":      time_ms,
            "time_display": time_display,
            "place":        place,
            "age_class":    cat["Nom"].strip() if cat else None,
            "finish_code":  finish_code,
            "points":       points,
            "is_valid_time": is_valid,
            "group_name":   group_name,
        })

    return {
        "competition": competition,
        "skaters":     list(skaters_seen.values()),
        "results":     results,
    }
