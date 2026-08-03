import { useState, useEffect, useRef } from "react";
import { useAuth } from "../contexts/AuthContext";
import { adminApi } from "../api";

// ── Upload tab ────────────────────────────────────────────────────────────────

function UploadTab({ getToken }) {
  const [file, setFile] = useState(null);
  const [trackType, setTrackType] = useState("ST");
  const [status, setStatus] = useState(null); // null | {ok, msg}
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef();

  function handleFile(f) {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".pat")) {
      setStatus({ ok: false, msg: "Only .pat files are accepted." });
      return;
    }
    setFile(f);
    setStatus(null);
  }

  async function handleUpload() {
    if (!file) return;
    setUploading(true);
    setStatus(null);
    try {
      const token = await getToken();
      const result = await adminApi.uploadPat(token, file, trackType);
      setStatus({ ok: true, msg: `"${result.filename}" queued — results will appear in a few minutes.` });
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
    } catch (e) {
      setStatus({ ok: false, msg: e.message || "Upload failed." });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="max-w-lg">
      {/* Drop zone */}
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFile(e.dataTransfer.files[0]);
        }}
        className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
          dragOver
            ? "border-brand-600 bg-brand-50"
            : "border-gray-300 hover:border-brand-300 hover:bg-gray-50"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pat"
          className="hidden"
          onChange={(e) => handleFile(e.target.files[0])}
        />
        {file ? (
          <div>
            <p className="font-medium text-gray-800">{file.name}</p>
            <p className="text-sm text-gray-400 mt-1">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
          </div>
        ) : (
          <div>
            <p className="text-gray-500">Drop a <span className="font-mono">.pat</span> file here</p>
            <p className="text-sm text-gray-400 mt-1">or click to browse</p>
          </div>
        )}
      </div>

      {/* Track type */}
      <div className="flex items-center gap-6 mt-4">
        <span className="text-sm font-medium text-gray-600">Track type</span>
        {[["ST", "Short Track"], ["LT", "Long Track"]].map(([val, label]) => (
          <label key={val} className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="trackType"
              value={val}
              checked={trackType === val}
              onChange={() => setTrackType(val)}
              className="text-brand-600"
            />
            <span className="text-sm text-gray-700">{label}</span>
          </label>
        ))}
      </div>

      {/* Upload button */}
      <button
        onClick={handleUpload}
        disabled={!file || uploading}
        className="mt-5 px-6 py-2 bg-brand-700 text-white rounded font-medium text-sm
                   hover:bg-brand-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {uploading ? "Uploading…" : "Upload"}
      </button>

      {/* Status */}
      {status && (
        <p className={`mt-3 text-sm ${status.ok ? "text-green-700" : "text-red-600"}`}>
          {status.msg}
        </p>
      )}
    </div>
  );
}

// ── Manage admins tab ─────────────────────────────────────────────────────────

function UsersTab({ getToken, currentEmail }) {
  const [users, setUsers] = useState(null);
  const [newEmail, setNewEmail] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState(null);

  async function load() {
    try {
      const token = await getToken();
      setUsers(await adminApi.getUsers(token));
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleAdd(e) {
    e.preventDefault();
    if (!newEmail.trim()) return;
    setAdding(true);
    setError(null);
    try {
      const token = await getToken();
      await adminApi.addUser(token, newEmail.trim());
      setNewEmail("");
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(email) {
    if (!confirm(`Remove ${email} from admins?`)) return;
    try {
      const token = await getToken();
      await adminApi.removeUser(token, email);
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  if (users === null && !error) return <p className="text-gray-400 text-sm">Loading…</p>;

  return (
    <div className="max-w-lg">
      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

      {users && (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden mb-5">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 uppercase text-xs tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">Email</th>
                <th className="px-4 py-3 text-left hidden sm:table-cell">Added</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.map((u) => (
                <tr key={u.email} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 text-gray-800">{u.email}</td>
                  <td className="px-4 py-2.5 text-gray-400 text-xs hidden sm:table-cell">
                    {u.added_at ? new Date(u.added_at).toLocaleDateString("en-CA") : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {u.email.toLowerCase() !== currentEmail && (
                      <button
                        onClick={() => handleRemove(u.email)}
                        className="text-red-500 hover:text-red-700 text-xs font-medium"
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form onSubmit={handleAdd} className="flex gap-2">
        <input
          type="email"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          placeholder="new.admin@example.com"
          className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm
                     focus:outline-none focus:ring-2 focus:ring-brand-600"
        />
        <button
          type="submit"
          disabled={adding || !newEmail.trim()}
          className="px-4 py-2 bg-brand-700 text-white rounded text-sm font-medium
                     hover:bg-brand-800 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {adding ? "Adding…" : "Add"}
        </button>
      </form>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Admin() {
  const { user, loading, login, logout } = useAuth();
  const [tab, setTab] = useState("upload");
  const [accessError, setAccessError] = useState(null);

  const getToken = async () => {
    if (!user) throw new Error("Not signed in");
    return user.getIdToken();
  };

  // If signed in, verify admin access on first render
  useEffect(() => {
    if (!user) return;
    setAccessError(null);
    user.getIdToken().then((token) =>
      adminApi.getUsers(token)
        .catch((e) => {
          if (e.status === 403 || (e.message && e.message.includes("403"))) {
            setAccessError("Your account is not authorised for admin access.");
          }
        })
    );
  }, [user]);

  if (loading) {
    return <p className="text-gray-400 text-sm">Loading…</p>;
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-gray-600 mb-6">Sign in to access the admin dashboard.</p>
        <button
          onClick={login}
          className="flex items-center gap-3 px-6 py-3 bg-white border border-gray-300
                     rounded-lg shadow-sm text-gray-700 font-medium hover:bg-gray-50 transition"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Sign in with Google
        </button>
      </div>
    );
  }

  if (accessError) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-red-600 font-medium mb-2">Access denied</p>
        <p className="text-gray-500 text-sm mb-6">{accessError}</p>
        <button onClick={logout} className="text-sm text-brand-600 hover:underline">
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Admin</h1>
        <div className="flex items-center gap-3 text-sm text-gray-500">
          <span>{user.email}</span>
          <button onClick={logout} className="text-brand-600 hover:underline">
            Sign out
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 mb-6 border-b border-gray-200">
        {[["upload", "Upload PAT"], ["users", "Manage Admins"]].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-5 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === key
                ? "border-brand-700 text-brand-700"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "upload" && <UploadTab getToken={getToken} />}
      {tab === "users" && (
        <UsersTab getToken={getToken} currentEmail={user.email?.toLowerCase()} />
      )}
    </div>
  );
}
