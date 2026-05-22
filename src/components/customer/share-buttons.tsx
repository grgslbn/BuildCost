"use client";

import { useState } from "react";

const ACCENT = "#C85A2A";

export function ShareButtons({ estimationId }: { estimationId: string }) {
  const [copied, setCopied] = useState(false);
  const [emailInput, setEmailInput] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [emailSending, setEmailSending] = useState(false);

  const reportUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/report/${estimationId}`
      : `/report/${estimationId}`;

  async function handleCopy() {
    await navigator.clipboard.writeText(reportUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleEmailSend(e: React.FormEvent) {
    e.preventDefault();
    setEmailSending(true);
    await fetch("/api/my/share-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estimationId, toEmail: emailInput }),
    });
    setEmailSent(true);
    setEmailSending(false);
  }

  const btnBase: React.CSSProperties = {
    padding: "0.5rem 1rem",
    borderRadius: "0.5rem",
    fontSize: "0.875rem",
    fontWeight: 500,
    cursor: "pointer",
    border: `1px solid ${ACCENT}`,
    background: "transparent",
    color: ACCENT,
    transition: "background 0.15s",
  };

  return (
    <div className="space-y-4">
      {/* Copy link */}
      <div className="flex items-center gap-2">
        <input
          readOnly
          value={reportUrl}
          style={{
            flex: 1,
            background: "#f8f5f0",
            border: "1px solid #e8e3dc",
            borderRadius: "0.5rem",
            padding: "0.5rem 0.75rem",
            fontSize: "0.8125rem",
            color: "#555",
            fontFamily: "monospace",
          }}
        />
        <button onClick={handleCopy} style={btnBase}>
          {copied ? "Copied!" : "Copy link"}
        </button>
      </div>

      {/* Email to colleague */}
      {emailSent ? (
        <p style={{ fontSize: "0.875rem", color: "#16a34a" }}>Email sent!</p>
      ) : (
        <form onSubmit={handleEmailSend} className="flex items-center gap-2">
          <input
            type="email"
            placeholder="colleague@company.com"
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            required
            style={{
              flex: 1,
              background: "#f8f5f0",
              border: "1px solid #e8e3dc",
              borderRadius: "0.5rem",
              padding: "0.5rem 0.75rem",
              fontSize: "0.875rem",
              color: "#1a1a1a",
            }}
          />
          <button type="submit" disabled={emailSending} style={btnBase}>
            {emailSending ? "Sending…" : "Email report"}
          </button>
        </form>
      )}
    </div>
  );
}
