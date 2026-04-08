"use client";

import { useState, useEffect } from "react";

export function useAuth(): { token: string | null | undefined; setToken: (t: string) => void } {
  // undefined = not checked yet, null = no token, string = has token
  const [token, setTokenState] = useState<string | null | undefined>(undefined);

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
    setTokenState(stored ?? null);
  }, []);

  function setToken(t: string) {
    localStorage.setItem("kern-token", t);
    setTokenState(t);
  }

  return { token, setToken };
}
