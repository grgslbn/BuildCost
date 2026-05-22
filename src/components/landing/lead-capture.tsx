"use client";

import { useState } from "react";

export type LeadCaptureMode = "report" | "pending" | "expert_review";

export default function LeadCapture({
  estimationId,
  mode = "report",
  onUnlock,
}: {
  estimationId: string | null;
  mode?: LeadCaptureMode;
  onUnlock: () => void;
}) {
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [emailStatus, setEmailStatus] = useState<"sent" | "pending" | "no_estimation" | null>(null);
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
        body: JSON.stringify({
          email, company, role,
          estimationId,
          intent: mode === "expert_review" ? "expert_review" : "report",
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error ?? "Submission failed.");
      }
      const data = (await res.json()) as { emailStatus?: "sent" | "pending" | "no_estimation" };
      setEmailStatus(data.emailStatus ?? "pending");
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
        <h3>
          {emailStatus === "sent"
            ? `Your full report is on its way to ${email}`
            : mode === "expert_review"
            ? "Thanks — our team will be in touch"
            : "We're still analyzing your plan"}
        </h3>
        <p>
          {emailStatus === "sent"
            ? "Check your inbox in the next minute or two. The detailed breakdown is unlocked below."
            : mode === "expert_review"
            ? "We'll review your plan and send you a detailed estimate within one business day."
            : "We'll email your results as soon as they're ready — usually within the hour."}
        </p>
      </div>
    );
  }

  const heading =
    mode === "expert_review"
      ? "Have an expert review your plan"
      : mode === "pending"
      ? "Get your results by email"
      : "Unlock the full analysis";

  const blurb =
    mode === "expert_review"
      ? "We couldn't fully analyze this plan automatically. Leave your email and our team will review it and send you a detailed estimate."
      : mode === "pending"
      ? "Your plan is taking a bit longer to analyze. Leave your email and we'll send your complete rebuild cost estimate within the hour."
      : "Get the complete report — detailed cost breakdown, room-by-room analysis, 35 quality parameters, and a downloadable PDF.";

  const bullets =
    mode === "expert_review"
      ? [
          "Human review of complex / non-standard plans",
          "Detailed estimate within one business day",
          "Free for your first plan",
        ]
      : [
          "Detailed cost per area category",
          "Room-by-room surface breakdown",
          "35 quality parameter assessments",
          "Price benchmarking",
          "Downloadable PDF report",
        ];

  const cta =
    mode === "expert_review"
      ? "Have an expert review my plan →"
      : mode === "pending"
      ? "Send me my results →"
      : "Get my full report →";

  return (
    <form className="lc-root" onSubmit={handleSubmit}>
      <div className="lc-head">
        <div className="lc-head-icon">{mode === "expert_review" ? "👤" : "🔓"}</div>
        <h3>{heading}</h3>
        <p>{blurb}</p>
      </div>

      <div className="lc-bullets">
        {bullets.map((b, i) => <div key={i}>· {b}</div>)}
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
        {submitting ? "Sending…" : cta}
      </button>

      <div className="lc-privacy">
        🔒 Your data stays private. We don't share or sell emails.
      </div>
    </form>
  );
}
