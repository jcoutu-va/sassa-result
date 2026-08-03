import { useState, useEffect, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../contexts/AuthContext";

function formatDate(raw) {
  if (!raw) return "—";
  return new Date(raw).toLocaleDateString("en-CA");
}

// ── Best Times view ──────────────────────────────────────────────────────────

function BestTimesView({ skater, seasons }) {
  const [selectedSeason, setSelectedSeason] = useState("career");
  const [bestTimes, setBestTimes] = useState(null);
  const [loading, setLoading] = useState(false);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  useEffect(() => {
    if (selectedSeason === "career") {
      setBestTimes(skater.best_times);
    } else if (selectedSeason !== "custom") {
      setLoading(true);
      api
        .skaterSeason(skater.skater.code_pat, selectedSeason)
        .then((d) => setBestTimes(d.best_times))
        .finally(() => setLoading(false));
    }
  }, [selectedSeason]);

  function fetchCustom() {
    if (!customFrom || !customTo) return;
    setLoading(true);
    api
      .skaterBestTimes(skater.skater.code_pat, customFrom, customTo)
      .then((d) => setBestTimes(d.best_times))
      .finally(() => setLoading(false));
  }

  const byTrack = useMemo(() => {
    if (!bestTimes) return {};
    return bestTimes.reduce((acc, r) => {
      const key = r.track_type === "LT" ? "Long Track" : "Short Track";
      (acc[key] = acc[key] || []).push(r);
      return acc;
    }, {});
  }, [bestTimes]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <select
          value={selectedSeason}
          onChange={(e) => {
            setSelectedSeason(e.target.value);
            if (e.target.value !== "custom") setBestTimes(null);
          }}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
        >
          <option value="career">Career best</option>
          {seasons.map((s) => (
            <option key={s} value={s}>{s} season</option>
          ))}
          <option value="custom">Custom period…</option>
        </select>

        {selectedSeason === "custom" && (
          <>
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
            />
            <span className="text-gray-400 text-sm">to</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
            />
            <button
              onClick={fetchCustom}
              disabled={!customFrom || !customTo}
              className="px-3 py-1.5 rounded text-sm font-medium bg-brand-700 text-white hover:bg-brand-800 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              View
            </button>
          </>
        )}
      </div>

      {loading && <p className="text-gray-400 text-sm">Loading…</p>}

      {!loading && bestTimes?.length === 0 && (
        <p className="text-gray-400 text-sm">No results recorded.</p>
      )}

      {!loading &&
        Object.entries(byTrack).map(([trackLabel, times]) => (
          <div key={trackLabel} className="mb-6">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
              {trackLabel}
            </h2>
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 uppercase text-xs tracking-wide">
                  <tr>
                    <th className="px-4 py-3 text-left">Distance</th>
                    <th className="px-4 py-3 text-right">Best Time</th>
                    <th className="px-4 py-3 text-left hidden sm:table-cell">Competition</th>
                    <th className="px-4 py-3 text-left hidden sm:table-cell">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {times.map((r) => (
                    <tr key={r.distance + r.track_type} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-800">{r.distance}</td>
                      <td className="px-4 py-3 text-right font-mono font-semibold text-brand-700">
                        {r.best_time_display || "—"}
                      </td>
                      <td className="px-4 py-3 text-gray-500 hidden sm:table-cell text-sm">
                        {r.achieved_at || "—"}
                      </td>
                      <td className="px-4 py-3 text-gray-500 hidden sm:table-cell text-sm">
                        {formatDate(r.achieved_on)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
    </div>
  );
}

// ── All Results view ─────────────────────────────────────────────────────────

function AllResultsView({ codePat, seasons }) {
  const [allResults, setAllResults] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filterSeason, setFilterSeason] = useState("all");
  const [filterComp, setFilterComp] = useState("all");

  useEffect(() => {
    api
      .skaterResults(codePat)
      .then((d) => setAllResults(d.results))
      .finally(() => setLoading(false));
  }, [codePat]);

  // Derive distinct competitions from results
  const competitions = useMemo(() => {
    if (!allResults) return [];
    const seen = new Map();
    for (const r of allResults) {
      if (!seen.has(r.competition_id)) {
        seen.set(r.competition_id, {
          id: r.competition_id,
          name: r.competition_name,
          date: r.competition_date,
          season: r.season,
          track_type: r.track_type,
        });
      }
    }
    return [...seen.values()].sort(
      (a, b) => new Date(b.date) - new Date(a.date)
    );
  }, [allResults]);

  // Apply filters
  const filtered = useMemo(() => {
    if (!allResults) return [];
    return allResults.filter((r) => {
      if (filterSeason !== "all" && r.season !== filterSeason) return false;
      if (filterComp !== "all" && String(r.competition_id) !== filterComp) return false;
      return true;
    });
  }, [allResults, filterSeason, filterComp]);

  // Group by competition
  const byComp = useMemo(() => {
    const map = new Map();
    for (const r of filtered) {
      if (!map.has(r.competition_id)) {
        map.set(r.competition_id, {
          id: r.competition_id,
          name: r.competition_name,
          date: r.competition_date,
          season: r.season,
          track_type: r.track_type,
          races: [],
        });
      }
      map.get(r.competition_id).races.push(r);
    }
    return [...map.values()].sort(
      (a, b) => new Date(b.date) - new Date(a.date)
    );
  }, [filtered]);

  if (loading) return <p className="text-gray-400 text-sm">Loading…</p>;

  // Available comps for current season filter
  const filteredComps =
    filterSeason === "all"
      ? competitions
      : competitions.filter((c) => c.season === filterSeason);

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <select
          value={filterSeason}
          onChange={(e) => { setFilterSeason(e.target.value); setFilterComp("all"); }}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
        >
          <option value="all">All seasons</option>
          {seasons.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <select
          value={filterComp}
          onChange={(e) => setFilterComp(e.target.value)}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
        >
          <option value="all">All events</option>
          {filteredComps.map((c) => (
            <option key={c.id} value={String(c.id)}>{c.name}</option>
          ))}
        </select>
      </div>

      {byComp.length === 0 ? (
        <p className="text-gray-400 text-sm">No results for the selected filters.</p>
      ) : (
        <div className="space-y-6">
          {byComp.map((comp) => (
            <div key={comp.id}>
              <div className="flex items-center gap-2 mb-2">
                <Link
                  to={`/competitions/${comp.id}/results`}
                  className="font-semibold text-gray-800 hover:text-brand-600"
                >
                  {comp.name}
                </Link>
                <span className="text-gray-400 text-xs">{formatDate(comp.date)}</span>
                <span
                  className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${
                    comp.track_type === "LT"
                      ? "bg-brand-100 text-brand-700"
                      : "bg-orange-100 text-orange-700"
                  }`}
                >
                  {comp.track_type}
                </span>
              </div>

              <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-500 uppercase text-xs tracking-wide">
                    <tr>
                      <th className="px-4 py-2 text-left">Distance</th>
                      <th className="px-4 py-2 text-left">Heat</th>
                      <th className="px-4 py-2 text-center">Place</th>
                      <th className="px-4 py-2 text-right">Time</th>
                      <th className="px-4 py-2 text-right hidden sm:table-cell">Points</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {comp.races.map((r) => (
                      <tr key={r.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 text-gray-800">{r.distance}</td>
                        <td className="px-4 py-2 text-gray-500 text-xs">
                          {r.qual_or_fin === "Qual" ? "Qual" : "Final"} H{r.heat}
                        </td>
                        <td className="px-4 py-2 text-center text-gray-500">
                          {r.place != null ? `#${r.place}` : "—"}
                        </td>
                        <td className="px-4 py-2 text-right font-mono font-semibold">
                          {r.finish_code ? (
                            <span className="text-red-500 text-xs font-sans">{r.finish_code}</span>
                          ) : (
                            <span className="text-brand-700">{r.time_display || "—"}</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right text-gray-400 text-xs hidden sm:table-cell">
                          {r.points > 0 ? Number(r.points).toFixed(0) : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SkaterProfile() {
  const { codePat } = useParams();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [seasons, setSeasons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("best");

  useEffect(() => {
    setLoading(true);
    const fetchData = async () => {
      const token = user ? await user.getIdToken().catch(() => null) : null;
      const [d, s] = await Promise.all([api.skater(codePat, token), api.seasons()]);
      setData(d);
      setSeasons(s);
    };
    fetchData()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [codePat, user]);

  if (loading) return <p className="text-gray-400 text-sm">Loading…</p>;
  if (error) return <p className="text-red-500 text-sm">{error}</p>;
  if (!data) return null;

  const { skater } = data;

  return (
    <div>
      <Link to="/skaters" className="text-brand-600 text-sm hover:underline">
        ← Athletes
      </Link>

      <div className="mt-4 mb-5">
        <h1 className="text-3xl font-bold text-gray-900">
          {skater.first_name} {skater.last_name}
        </h1>
        <p className="text-gray-500 mt-1 text-sm">
          {skater.club_name}
          {skater.dob ? ` · Born ${formatDate(skater.dob)}` : ""}
          {skater.gender ? ` · ${skater.gender === "M" ? "Male" : "Female"}` : ""}
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 mb-6 border-b border-gray-200">
        <button
          onClick={() => setTab("best")}
          className={`px-5 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === "best"
              ? "border-brand-700 text-brand-700"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          Best Times
        </button>
        <button
          onClick={() => setTab("all")}
          className={`px-5 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === "all"
              ? "border-brand-700 text-brand-700"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          All Results
        </button>
      </div>

      {tab === "best" && <BestTimesView skater={data} seasons={seasons} />}
      {tab === "all" && <AllResultsView codePat={codePat} seasons={seasons} />}
    </div>
  );
}
