import { useState, useEffect, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../contexts/AuthContext";

function formatDate(raw) {
  if (!raw) return "";
  return new Date(raw).toLocaleDateString("en-CA");
}

// Extract the numeric prefix from a group name for sort ordering.
// "1 - Open" → 1, "7" → 7, "Active Start" → Infinity
function groupSortKey(groupName) {
  const n = parseInt(String(groupName || ""));
  return isNaN(n) ? Infinity : n;
}

// Human-readable label: strip the numeric prefix if a description follows.
// "1 - Open" → "Open", "2 - Masters" → "Masters", "3" → "Group 3"
function groupLabel(groupName) {
  if (!groupName) return "?";
  const m = String(groupName).match(/^\d+\s*-\s*(.+)$/);
  return m ? m[1].trim() : `Group ${String(groupName).trim()}`;
}

// Fallback when group_name is missing: derive from the last Final heat letter.
function groupFromHeat(races) {
  const finals = races.filter((r) => r.qual_or_fin === "Fin");
  const pool = finals.length > 0 ? finals : races;
  const last = pool.reduce((best, r) => {
    const n = parseInt(String(r.heat)) || 0;
    const bn = parseInt(String(best.heat)) || 0;
    return n > bn ? r : best;
  }, pool[0]);
  if (!last) return "?";
  const m = String(last.heat || "").match(/([A-Za-z]+)$/);
  return m ? m[1].toUpperCase() : "?";
}

function processGroups(results) {
  const skaterMap = {};
  for (const r of results) {
    if (!skaterMap[r.code_pat]) {
      skaterMap[r.code_pat] = {
        code_pat: r.code_pat,
        first_name: r.first_name,
        last_name: r.last_name,
        club: r.club_abbrev || r.club_name || "",
        age_class: r.age_class || "",
        group_name: r.group_name || null,
        total_points: 0,
        races: [],
      };
    }
    const sk = skaterMap[r.code_pat];
    sk.total_points += Number(r.points) || 0;
    sk.races.push(r);
  }

  const groupMap = {};
  for (const sk of Object.values(skaterMap)) {
    // Use group_name directly; fall back to heat-letter for legacy data
    const key = sk.group_name || groupFromHeat(sk.races);
    (groupMap[key] = groupMap[key] || []).push(sk);
  }

  for (const skaters of Object.values(groupMap)) {
    skaters.sort(
      (a, b) =>
        b.total_points - a.total_points ||
        a.last_name.localeCompare(b.last_name)
    );
    for (const sk of skaters) {
      sk.races.sort((a, b) => {
        const d = a.distance.localeCompare(b.distance);
        if (d !== 0) return d;
        if (a.qual_or_fin !== b.qual_or_fin)
          return a.qual_or_fin === "Qual" ? -1 : 1;
        return String(a.heat).localeCompare(String(b.heat));
      });
    }
  }

  // Sort groups by numeric prefix (non-numeric groups sort last)
  return Object.entries(groupMap)
    .sort(([a], [b]) => groupSortKey(a) - groupSortKey(b))
    .map(([key, skaters]) => ({ key, label: groupLabel(key), skaters }));
}

// ── Distance view: all results for one distance, fastest to slowest ──────────

function DistanceView({ results }) {
  const distances = useMemo(
    () => [...new Set(results.map((r) => r.distance))].sort(),
    [results]
  );
  const [selectedDistance, setSelectedDistance] = useState(distances[0] || "");

  // Only valid-time finals rows for the selected distance, ranked by time_ms
  const rows = useMemo(() => {
    return results
      .filter(
        (r) =>
          r.distance === selectedDistance &&
          r.qual_or_fin === "Fin" &&
          r.is_valid_time &&
          r.time_ms != null
      )
      .sort((a, b) => a.time_ms - b.time_ms);
  }, [results, selectedDistance]);

  // All finals rows (including DNS/DNF) that didn't make the valid list
  const invalid = useMemo(() => {
    return results.filter(
      (r) =>
        r.distance === selectedDistance &&
        r.qual_or_fin === "Fin" &&
        (!r.is_valid_time || r.time_ms == null)
    );
  }, [results, selectedDistance]);

  return (
    <div>
      {/* Distance picker */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <label className="text-sm font-medium text-gray-600">Distance</label>
        <select
          value={selectedDistance}
          onChange={(e) => setSelectedDistance(e.target.value)}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
        >
          {distances.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
      </div>

      {rows.length === 0 && invalid.length === 0 ? (
        <p className="text-gray-400 text-sm">No final results for this distance.</p>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 uppercase text-xs tracking-wide">
              <tr>
                <th className="px-4 py-3 text-center w-10">Rank</th>
                <th className="px-4 py-3 text-left">Athlete</th>
                <th className="px-4 py-3 text-left hidden sm:table-cell">Club</th>
                <th className="px-4 py-3 text-left hidden sm:table-cell">Category</th>
                <th className="px-4 py-3 text-left hidden sm:table-cell">Grp</th>
                <th className="px-4 py-3 text-right">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r, i) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 text-center text-gray-500 font-medium">{i + 1}</td>
                  <td className="px-4 py-2.5">
                    <Link
                      to={`/skaters/${r.code_pat}`}
                      className="font-medium text-gray-800 hover:text-brand-600"
                    >
                      {r.first_name} {r.last_name}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-gray-500 hidden sm:table-cell">
                    {r.club_abbrev || r.club_name || "—"}
                  </td>
                  <td className="px-4 py-2.5 text-gray-500 hidden sm:table-cell">
                    {r.age_class || "—"}
                  </td>
                  <td className="px-4 py-2.5 text-gray-400 text-xs hidden sm:table-cell">
                    {r.group_name ? groupLabel(r.group_name) : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono font-semibold text-brand-700">
                    {r.time_display}
                  </td>
                </tr>
              ))}
              {invalid.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50 opacity-50">
                  <td className="px-4 py-2.5 text-center text-gray-300">—</td>
                  <td className="px-4 py-2.5">
                    <Link
                      to={`/skaters/${r.code_pat}`}
                      className="text-gray-500 hover:text-brand-600"
                    >
                      {r.first_name} {r.last_name}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-gray-400 hidden sm:table-cell">
                    {r.club_abbrev || r.club_name || "—"}
                  </td>
                  <td className="px-4 py-2.5 text-gray-400 hidden sm:table-cell">
                    {r.age_class || "—"}
                  </td>
                  <td className="px-4 py-2.5 text-gray-300 text-xs hidden sm:table-cell">
                    {r.group_name ? groupLabel(r.group_name) : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right text-red-400 text-xs">
                    {r.finish_code || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CompetitionResults() {
  const { id } = useParams();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [viewMode, setViewMode] = useState("groups"); // "groups" | "distance"
  const [selectedGroup, setSelectedGroup] = useState("all");

  useEffect(() => {
    const fetchData = async () => {
      const token = user ? await user.getIdToken().catch(() => null) : null;
      const d = await api.competitionResults(id, token);
      setData(d);
    };
    fetchData()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id, user]);

  const groups = useMemo(
    () => (data ? processGroups(data.results) : []),
    [data]
  );

  if (loading) return <p className="text-gray-400 text-sm">Loading…</p>;
  if (error) return <p className="text-red-500 text-sm">{error}</p>;
  if (!data) return null;

  const { competition } = data;
  const visibleGroups =
    selectedGroup === "all"
      ? groups
      : groups.filter((g) => g.key === selectedGroup);

  return (
    <div>
      <Link to="/" className="text-brand-600 text-sm hover:underline">
        ← Events
      </Link>

      <div className="mt-4 mb-5">
        <h1 className="text-2xl font-bold text-gray-900">{competition.name}</h1>
        <p className="text-gray-500 mt-1 text-sm">
          {formatDate(competition.date)} ·{" "}
          <span
            className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
              competition.track_type === "LT"
                ? "bg-brand-100 text-brand-700"
                : "bg-orange-100 text-orange-700"
            }`}
          >
            {competition.track_type === "LT" ? "Long Track" : "Short Track"}
          </span>{" "}
          · {data.results.length} entries · {groups.length} group{groups.length !== 1 ? "s" : ""}
        </p>
      </div>

      {/* View mode toggle */}
      <div className="flex gap-0 mb-5 border-b border-gray-200">
        <button
          onClick={() => setViewMode("groups")}
          className={`px-5 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            viewMode === "groups"
              ? "border-brand-700 text-brand-700"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          By Group
        </button>
        <button
          onClick={() => setViewMode("distance")}
          className={`px-5 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            viewMode === "distance"
              ? "border-brand-700 text-brand-700"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          By Distance
        </button>
      </div>

      {/* ── By Distance view ── */}
      {viewMode === "distance" && <DistanceView results={data.results} />}

      {/* ── By Group view ── */}
      {viewMode === "groups" && (
        <>
          <div className="flex items-center gap-3 mb-6 flex-wrap">
            <label className="text-sm font-medium text-gray-600">Group</label>
            <div className="flex gap-1 flex-wrap">
              <button
                onClick={() => setSelectedGroup("all")}
                className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                  selectedGroup === "all"
                    ? "bg-brand-700 text-white"
                    : "bg-white border border-gray-300 text-gray-600 hover:border-brand-300"
                }`}
              >
                All
              </button>
              {groups.map((g) => (
                <button
                  key={g.key}
                  onClick={() => setSelectedGroup(g.key)}
                  className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                    selectedGroup === g.key
                      ? "bg-brand-700 text-white"
                      : "bg-white border border-gray-300 text-gray-600 hover:border-brand-300"
                  }`}
                >
                  {g.label}
                  <span className="ml-1 text-xs opacity-70">({g.skaters.length})</span>
                </button>
              ))}
            </div>
          </div>

          {visibleGroups.map((group) => (
            <div key={group.key} className="mb-10">
              <h2 className="text-base font-semibold text-gray-700 border-b border-gray-200 pb-2 mb-3">
                {group.label}
              </h2>

              <div className="space-y-2">
                {group.skaters.map((sk, idx) => (
                  <div
                    key={sk.code_pat}
                    className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden"
                  >
                    <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-50 border-b border-gray-100">
                      <span className="text-gray-400 font-semibold text-sm w-5 text-right shrink-0">
                        {idx + 1}
                      </span>
                      <Link
                        to={`/skaters/${sk.code_pat}`}
                        className="font-semibold text-gray-900 hover:text-brand-600 flex-1 min-w-0"
                      >
                        {sk.first_name} {sk.last_name}
                      </Link>
                      <span className="text-gray-400 text-xs hidden sm:block shrink-0">
                        {sk.age_class}
                      </span>
                      <span className="text-gray-500 text-sm shrink-0">{sk.club}</span>
                      <span className="ml-2 text-brand-700 font-semibold text-sm whitespace-nowrap shrink-0">
                        {sk.total_points.toFixed(0)} pts
                      </span>
                    </div>

                    <table className="w-full text-sm">
                      <tbody>
                        {sk.races.map((r) => (
                          <tr
                            key={r.id}
                            className={`border-t border-gray-50 hover:bg-gray-50 ${
                              r.qual_or_fin === "Qual" ? "opacity-55" : ""
                            }`}
                          >
                            <td className="pl-10 pr-2 py-1.5 text-gray-700">{r.distance}</td>
                            <td className="px-2 py-1.5 text-gray-400 text-xs whitespace-nowrap w-24">
                              {r.qual_or_fin === "Qual" ? "Qual" : "Final"} H{r.heat}
                            </td>
                            <td className="px-2 py-1.5 text-gray-400 text-xs w-10">
                              {r.place != null ? `#${r.place}` : ""}
                            </td>
                            <td className="px-2 py-1.5 text-right font-mono font-semibold">
                              {r.finish_code ? (
                                <span className="text-red-500 text-xs font-sans font-normal">
                                  {r.finish_code}
                                </span>
                              ) : (
                                <span className="text-brand-700">{r.time_display || "—"}</span>
                              )}
                            </td>
                            <td className="px-4 py-1.5 text-right text-gray-400 text-xs w-20 whitespace-nowrap">
                              {Number(r.points) > 0
                                ? `${Number(r.points).toFixed(0)} pts`
                                : ""}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
