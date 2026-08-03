import { useState, useEffect } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { api } from "../api";

function formatDate(raw) {
  if (!raw) return "";
  return new Date(raw).toLocaleDateString("en-CA");
}

export default function Home({ tab }) {
  const [activeTab, setActiveTab] = useState(tab === "skaters" ? "skaters" : "events");
  const [seasons, setSeasons] = useState([]);
  const [selectedSeason, setSelectedSeason] = useState("");
  const [competitions, setCompetitions] = useState([]);
  const [skaters, setSkaters] = useState([]);
  const [searchQ, setSearchQ] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    api.seasons().then((s) => {
      setSeasons(s);
      if (s.length) setSelectedSeason(s[0]);
    });
  }, []);

  useEffect(() => {
    if (!selectedSeason) return;
    setLoading(true);
    api.competitions(selectedSeason)
      .then(setCompetitions)
      .finally(() => setLoading(false));
  }, [selectedSeason]);

  useEffect(() => {
    if (activeTab !== "skaters") return;
    setLoading(true);
    api.skaters(searchQ)
      .then(setSkaters)
      .finally(() => setLoading(false));
  }, [activeTab]);

  function handleSearch(e) {
    e.preventDefault();
    setLoading(true);
    api.skaters(searchQ)
      .then(setSkaters)
      .finally(() => setLoading(false));
  }

  return (
    <div>
      {/* Tabs */}
      <div className="flex gap-0 mb-6 border-b border-gray-200">
        <button
          onClick={() => { setActiveTab("events"); navigate("/"); }}
          className={`px-5 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeTab === "events"
              ? "border-brand-700 text-brand-700"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          Events
        </button>
        <button
          onClick={() => { setActiveTab("skaters"); navigate("/skaters"); }}
          className={`px-5 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeTab === "skaters"
              ? "border-brand-700 text-brand-700"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          Athletes
        </button>
      </div>

      {activeTab === "events" && (
        <div>
          {/* Season filter */}
          <div className="flex items-center gap-3 mb-4">
            <label className="text-sm font-medium text-gray-600">Season</label>
            <select
              value={selectedSeason}
              onChange={(e) => setSelectedSeason(e.target.value)}
              className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
            >
              {seasons.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {loading ? (
            <p className="text-gray-400 text-sm">Loading…</p>
          ) : competitions.length === 0 ? (
            <p className="text-gray-400 text-sm">No events found for this season.</p>
          ) : (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 uppercase text-xs tracking-wide">
                  <tr>
                    <th className="px-4 py-3 text-left">Competition</th>
                    <th className="px-4 py-3 text-left">Date</th>
                    <th className="px-4 py-3 text-left">Track</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {competitions.map((c) => (
                    <tr key={c.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-800">{c.name}</td>
                      <td className="px-4 py-3 text-gray-500">{formatDate(c.date)}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                          c.track_type === "LT"
                            ? "bg-brand-100 text-brand-700"
                            : "bg-orange-100 text-orange-700"
                        }`}>
                          {c.track_type === "LT" ? "Long Track" : "Short Track"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          to={`/competitions/${c.id}/results`}
                          className="text-brand-600 hover:underline text-xs font-medium"
                        >
                          Results →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === "skaters" && (
        <div>
          <form onSubmit={handleSearch} className="flex gap-2 mb-5">
            <input
              type="text"
              placeholder="Search by name…"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
            />
            <button
              type="submit"
              className="bg-brand-700 text-white px-4 py-2 rounded text-sm font-medium hover:bg-brand-800"
            >
              Search
            </button>
          </form>

          {loading ? (
            <p className="text-gray-400 text-sm">Loading…</p>
          ) : skaters.length === 0 ? (
            <p className="text-gray-400 text-sm">No athletes found.</p>
          ) : (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 uppercase text-xs tracking-wide">
                  <tr>
                    <th className="px-4 py-3 text-left">Name</th>
                    <th className="px-4 py-3 text-left">Club</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {skaters.map((s) => (
                    <tr key={s.code_pat} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-800">
                        {s.first_name} {s.last_name}
                      </td>
                      <td className="px-4 py-3 text-gray-500">{s.club_name}</td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          to={`/skaters/${s.code_pat}`}
                          className="text-brand-600 hover:underline text-xs font-medium"
                        >
                          Profile →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
