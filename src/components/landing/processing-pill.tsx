"use client";

import { useEffect, useState } from "react";

type Props = {
  estimationId: string | null;
  status: string | null;
  processShowEl: HTMLElement | null;
  onSubmitted: (email: string) => void;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ProcessingPill({ estimationId, status, processShowEl, onSubmitted }: Props) {
  const [outOfView, setOutOfView] = useState(false);
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const isProcessing = !!status && status !== "complete" && status !== "error";

  useEffect(() => {
    if (!processShowEl) { setOutOfView(false); return; }

    const evaluate = () => {
      const r = processShowEl.getBoundingClientRect();
      const vh = window.innerHeight || document.documentElement.clientHeight;
      setOutOfView(r.bottom < 0 || r.top > vh);
    };

    evaluate();

    let io: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver(
        ([entry]) => setOutOfView(!entry.isIntersecting),
        { threshold: 0 }
      );
      io.observe(processShowEl);
    }

    window.addEventListener("scroll", evaluate, { passive: true });
    window.addEventListener("resize", evaluate);
    return () => {
      io?.disconnect();
      window.removeEventListener("scroll", evaluate);
      window.removeEventListener("resize", evaluate);
    };
  }, [processShowEl]);

  useEffect(() => {
    if (!submittedEmail) return;
    const t1 = setTimeout(() => setLeaving(true), 3000);
    const t2 = setTimeout(() => setHidden(true), 3400);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [submittedEmail]);

  const shouldShow = isProcessing && outOfView && !hidden;
  if (!shouldShow) return null;

  function handleDismiss() {
    setLeaving(true);
    setTimeout(() => setHidden(true), 280);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!EMAIL_RE.test(email)) return;
    setSubmitting(true);
    try {
      await fetch("/api/public/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, estimationId, intent: "report" }),
      });
      setSubmittedEmail(email);
      onSubmitted(email);
    } catch {
      /* swallow — user can retry from the section-4 form if needed */
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={`processing-pill${leaving ? " leaving" : ""}${submittedEmail ? " submitted" : ""}`} role="status">
      {submittedEmail ? (
        <span className="pp-success">
          <span className="pp-check">✓</span>
          We&apos;ll send your report to <strong>{submittedEmail}</strong>
        </span>
      ) : (
        <>
          <span className="pp-text">Taking too long? We&apos;ll email your report →</span>
          <form className="pp-form" onSubmit={handleSubmit}>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              required
              autoComplete="email"
              aria-label="Email address"
            />
            <button type="submit" disabled={submitting}>
              {submitting ? "…" : "Send"}
            </button>
          </form>
          <button
            type="button"
            className="pp-close"
            aria-label="Dismiss"
            onClick={handleDismiss}
          >
            ×
          </button>
        </>
      )}
    </div>
  );
}
