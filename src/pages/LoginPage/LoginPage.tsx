import { useState } from "react";
import type { FormEvent } from "react";
import { useAuth } from "@/context/useAuth";
import useHaptics from "@/hooks/useHaptics";
import LogoLockup from "@/components/LogoLockup";

export default function LoginPage() {
  const { login, plexLogin } = useAuth();
  const haptics = useHaptics();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [plexLoggingIn, setPlexLoggingIn] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");

    if (!username || !password) {
      setError("Username and password are required");
      return;
    }

    setLoggingIn(true);
    try {
      await login(username, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoggingIn(false);
    }
  };

  const handlePlexLogin = async () => {
    haptics.medium();
    setError("");
    setPlexLoggingIn(true);
    try {
      await plexLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Plex login failed");
    } finally {
      setPlexLoggingIn(false);
    }
  };

  const anyLoading = loggingIn || plexLoggingIn;

  return (
    <div className="min-h-screen bg-amber-50 dark:bg-gray-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-6">
          <LogoLockup size="lg" />
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border-2 border-black dark:border-gray-600 shadow-cartoon-lg">
          {/* The card's purpose is obvious on screen; keep a heading for
              assistive tech, which has no such context. */}
          <h1 className="sr-only">Sign in to Tunearr</h1>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="username"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
              >
                Username
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border-2 border-black dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-cartoon-sm focus:outline-none focus:ring-2 focus:ring-amber-300"
                autoComplete="username"
                autoFocus
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border-2 border-black dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-cartoon-sm focus:outline-none focus:ring-2 focus:ring-amber-300"
                autoComplete="current-password"
              />
            </div>

            {error && (
              <div className="p-3 rounded-md text-sm bg-red-900/30 text-red-400 border border-red-800">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={anyLoading}
              className="w-full px-4 py-2 bg-amber-300 hover:bg-amber-200 disabled:opacity-50 text-black font-bold rounded-lg text-sm border-2 border-black shadow-cartoon-sm hover:translate-y-[-1px] hover:shadow-cartoon-md active:translate-y-[1px] active:shadow-cartoon-pressed transition-all"
            >
              {loggingIn ? "Signing in..." : "Sign In"}
            </button>
          </form>

          <div className="relative my-5">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-300 dark:border-gray-600" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                or
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={handlePlexLogin}
            disabled={anyLoading}
            className="w-full px-4 py-2 bg-[#E5A00D] hover:bg-[#cc8f0b] disabled:opacity-50 text-black font-bold rounded-lg text-sm border-2 border-black shadow-cartoon-sm hover:translate-y-[-1px] hover:shadow-cartoon-md active:translate-y-[1px] active:shadow-cartoon-pressed transition-all"
          >
            {plexLoggingIn ? "Signing in with Plex..." : "Sign in with Plex"}
          </button>
        </div>
      </div>
    </div>
  );
}
