"use client";

import { useState } from "react";

export default function LeadCapture({
  estimationId,
  onUnlock,
}: {
  estimationId: string | null;
  onUnlock: () => void;
}) {
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Please enter a valid email address.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/public/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, company, role, estimationId }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error ?? "Submission failed.");
      }
      setSubmitted(true);
      onUnlock();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="lc-success">
        <div className="lc-success-icon">✓</div>
        <h3>Check your inbox</h3>
        <p>We'll send your full report shortly. The detailed breakdown is unlocked below.</p>
      </div>
    );
  }

  return (
    <form className="lc-root" onSubmit={handleSubmit}>
      <div className="lc-head">
        <div className="lc-head-icon">🔓</div>
        <h3>Unlock the full analysis</h3>
        <p>Get the complete report — detailed cost breakdown, room-by-room analysis, 35 quality parameters, and a downloadable PDF.</p>
      </div>

      <div className="lc-bullets">
        <div>· Detailed cost per area category</div>
        <div>· Room-by-room surface breakdown</div>
        <div>· 35 quality parameter assessments</div>
        <div>· Price benchmarking</div>
        <div>· Downloadable PDF report</div>
      </div>

      <div className="lc-fields">
        <label className="lc-field">
          <span>Email *</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            required
            autoComplete="email"
          />
        </label>
        <div className="lc-row">
          <label className="lc-field">
            <span>Company (optional)</span>
            <input
              type="text"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Acme Insurance"
              autoComplete="organization"
            />
          </label>
          <label className="lc-field">
            <span>Role (optional)</span>
            <input
              type="text"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="Claims adjuster"
              autoComplete="organization-title"
            />
          </label>
        </div>
      </div>

      {error && <div className="lc-error">{error}</div>}

      <button type="submit" className="lc-submit" disabled={submitting}>
        {submitting ? "Sending…" : "Get my full report →"}
      </button>

      <div className="lc-privacy">
        🔒 Your data stays private. We don't share or sell emails.
      </div>
    </form>
  );
}
