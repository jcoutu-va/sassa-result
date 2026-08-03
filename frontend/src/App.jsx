import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import Home from "./pages/Home";
import SkaterProfile from "./pages/SkaterProfile";
import CompetitionResults from "./pages/CompetitionResults";
import Admin from "./pages/Admin";

function Header() {
  const { user } = useAuth();
  return (
    <header className="bg-brand-900 text-white shadow">
      <div className="max-w-5xl mx-auto px-4 py-2 flex items-center justify-between">
        <Link to="/" className="shrink-0 hover:opacity-90 transition-opacity">
          <span className="inline-flex items-center bg-white rounded px-2 py-1">
            <img src="/logo.webp" alt="Speed Skating Sask" className="h-8 w-auto" />
          </span>
        </Link>
        <Link
          to="/admin"
          className={`text-sm transition-colors hover:text-brand-200 ${user ? "text-brand-200" : "text-brand-300"}`}
        >
          Admin
        </Link>
      </div>
    </header>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <div className="min-h-screen bg-gray-50">
          <Header />
          <main className="max-w-5xl mx-auto px-4 py-6">
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/skaters" element={<Home tab="skaters" />} />
              <Route path="/skaters/:codePat" element={<SkaterProfile />} />
              <Route path="/competitions/:id/results" element={<CompetitionResults />} />
              <Route path="/admin" element={<Admin />} />
            </Routes>
          </main>
        </div>
      </AuthProvider>
    </BrowserRouter>
  );
}
