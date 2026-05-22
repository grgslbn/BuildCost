"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ACCENT = "#C85A2A";

const NAV = [
  { label: "Overview", href: "/customer/overview" },
  { label: "Estimations", href: "/customer/estimations" },
  { label: "Usage", href: "/customer/usage" },
  { label: "Account", href: "/customer/account" },
];

export function CustomerNav({ tenantName }: { tenantName: string }) {
  const pathname = usePathname();

  return (
    <header
      style={{ background: "#fff", borderBottom: "1px solid #e8e3dc" }}
      className="sticky top-0 z-10"
    >
      <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
        {/* Logo / tenant */}
        <div className="flex items-center gap-3">
          <span
            style={{
              fontFamily: "var(--font-bricolage), sans-serif",
              fontWeight: 700,
              fontSize: "1.1rem",
              color: ACCENT,
            }}
          >
            BuildCost
          </span>
          <span style={{ color: "#aaa", fontSize: "0.85rem" }}>·</span>
          <span style={{ color: "#666", fontSize: "0.875rem" }}>{tenantName}</span>
        </div>

        {/* Navigation */}
        <nav className="flex items-center gap-1">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  fontSize: "0.875rem",
                  fontWeight: active ? 600 : 400,
                  color: active ? ACCENT : "#555",
                  padding: "0.375rem 0.75rem",
                  borderRadius: "0.375rem",
                  background: active ? `${ACCENT}12` : "transparent",
                  textDecoration: "none",
                  transition: "color 0.15s, background 0.15s",
                }}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
