"use client";

import { useState, useEffect } from "react";

export function useAuth(): { token: string | null; setToken: (t: string) => void } {
  const [token, setTokenState] = useState<string | null>(null);

  useEffect(() => {
    // Check URL params first
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get("token");
    if (urlToken) {
      localStorage.setItem("kern-token", urlToken);
      window.history.replaceState({}, "", window.location.pathname);
      setTokenState(urlToken);
      return;
    }
    // Fall back to localStorage
    const stored = localStorage.getItem("kern-token");
    setTokenState(stored);
  }, []);

  function setToken(t: string) {
    localStorage.setItem("kern-token", t);
    setTokenState(t);
  }

  return { token, setToken };
}
