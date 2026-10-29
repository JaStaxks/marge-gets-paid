"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { SHOP } from "@/lib/shop";

export function LoginForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);

  return (
    <main className="gate">
      <p className="muted">{SHOP.name}</p>
      <h1 style={{ fontFamily: "var(--font-display), Georgia, serif", letterSpacing: "-0.03em" }}>Owner desk</h1>
      <p>The board is behind the shop password. If DASHBOARD_PASSWORD is unset, the demo password is coastline.</p>
      <form
        className="stack"
        onSubmit={async (event) => {
          event.preventDefault();
          setWorking(true);
          setError("");
          const response = await fetch("/api/dashboard/login", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ password }),
          });
          setWorking(false);
          if (!response.ok) {
            const body = (await response.json()) as { error?: string };
            setError(body.error || "Could not sign in.");
            return;
          }
          router.refresh();
        }}
      >
        <label htmlFor="desk-password">Password</label>
        <input
          id="desk-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
        />
        {error ? (
          <p className="banner error-banner" role="alert">
            {error}
          </p>
        ) : null}
        <button className="primary" type="submit" disabled={working || password.length === 0}>
          {working ? "Checking…" : "Open the board"}
        </button>
      </form>
      <p>
        <a href="/">Back to Marge</a>
      </p>
    </main>
  );
}
