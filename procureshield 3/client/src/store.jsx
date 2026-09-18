import React, { createContext, useContext, useState, useEffect, useCallback } from "react";

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [officer, setOfficer] = useState(() => {
    const saved = sessionStorage.getItem("ps_officer");
    return saved ? JSON.parse(saved) : null;
  });

  useEffect(() => {
    if (officer) sessionStorage.setItem("ps_officer", JSON.stringify(officer));
    else sessionStorage.removeItem("ps_officer");
  }, [officer]);

  const login = useCallback((officerData, token) => {
    if (token) sessionStorage.setItem("ps_token", token);
    setOfficer(officerData);
  }, []);
  const logout = useCallback(() => {
    sessionStorage.removeItem("ps_token");
    setOfficer(null);
  }, []);

  // The backend now enforces its own auth (see server/middleware/auth.js).
  // If a request ever comes back 401 (expired/missing token), api.js fires
  // this event so the session is cleared and the user is bounced to /login
  // instead of the app silently failing on every subsequent call.
  useEffect(() => {
    const onUnauthorized = () => setOfficer(null);
    window.addEventListener("ps:unauthorized", onUnauthorized);
    return () => window.removeEventListener("ps:unauthorized", onUnauthorized);
  }, []);

  return (
    <AppContext.Provider value={{ officer, login, logout, isAuthenticated: !!officer }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
