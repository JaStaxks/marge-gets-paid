"use client";

export default function RootError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="gate">
      <h1>The page did not load.</h1>
      <p>If this is the deployed app, connect Upstash Redis so jobs persist, then try again.</p>
      <button className="primary" type="button" onClick={() => reset()}>
        Try again
      </button>
    </main>
  );
}
