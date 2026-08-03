const BASE = "https://skate-api-232158332347.northamerica-northeast1.run.app";

async function get(path) {
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`);
  return res.json();
}

async function authFetch(path, token, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, ...opts.headers },
  });
  if (!res.ok) {
    const err = new Error(`API error ${res.status}: ${path}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export const api = {
  seasons: () => get("/api/seasons"),
  competitions: (season) => get("/api/competitions" + (season ? `?season=${season}` : "")),
  competitionResults: (id, token) =>
    token ? authFetch(`/api/competitions/${id}/results`, token) : get(`/api/competitions/${id}/results`),
  skaters: (q) => get("/api/skaters" + (q ? `?q=${encodeURIComponent(q)}` : "")),
  skater: (codePat, token) =>
    token ? authFetch(`/api/skaters/${codePat}`, token) : get(`/api/skaters/${codePat}`),
  skaterSeason: (codePat, season) => get(`/api/skaters/${codePat}/seasons/${encodeURIComponent(season)}`),
  skaterBestTimes: (codePat, from, to) =>
    get(`/api/skaters/${codePat}/best-times?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
  skaterResults: (codePat, { season, competitionId } = {}) => {
    const params = new URLSearchParams();
    if (season) params.set("season", season);
    if (competitionId) params.set("competition_id", competitionId);
    const qs = params.toString();
    return get(`/api/skaters/${codePat}/results${qs ? "?" + qs : ""}`);
  },
};

export const adminApi = {
  getUsers: (token) => authFetch("/api/admin/users", token),

  addUser: (token, email) =>
    authFetch("/api/admin/users", token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    }),

  removeUser: (token, email) =>
    authFetch(`/api/admin/users/${encodeURIComponent(email)}`, token, { method: "DELETE" }),

  uploadPat: async (token, file, trackType) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("track_type", trackType);
    const res = await fetch(BASE + "/api/admin/upload", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    if (!res.ok) {
      const err = new Error(`Upload failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  },
};
