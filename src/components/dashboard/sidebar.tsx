"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  PlusCircle,
  FolderOpen,
  Settings,
  Building2,
  ChevronRight,
  BrainCircuit,
  BarChart3,
  Terminal,
  ClipboardList,
  Users,
  FlaskConical,
  Map,
  Mail,
  Cpu,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
  label: string;
  href: string;
  icon: React.ElementType;
  group?: string;
};

const NAV: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Analytics", href: "/analytics", icon: BarChart3 },
  { label: "New Estimation", href: "/estimate", icon: PlusCircle },
  { label: "Estimations", href: "/estimations", icon: ClipboardList },
  { label: "Dossiers",      href: "/admin/dossiers",      icon: FolderOpen,  group: "Engine" },
  { label: "Prompt Lab",    href: "/admin/prompt-lab",    icon: FlaskConical, group: "Engine" },
  { label: "Prompts",       href: "/admin/prompts",       icon: Terminal,    group: "Engine" },
  { label: "QQP Model",     href: "/admin/qqp",           icon: BrainCircuit, group: "Engine" },
  { label: "Settings",      href: "/admin/settings",      icon: Settings,    group: "Engine" },
  { label: "Leads",         href: "/admin/leads",         icon: Users,       group: "Business" },
  { label: "Tenants",       href: "/admin/tenants",       icon: Building2,   group: "Business" },
  { label: "Billing",       href: "/admin/billing",       icon: BarChart3,   group: "Business" },
  { label: "Roadmap",       href: "/admin/roadmap",       icon: Map,         group: "System" },
  { label: "Email test",    href: "/admin/email-test",    icon: Mail,        group: "System" },
  { label: "Pipeline test", href: "/admin/pipeline-test", icon: Cpu,         group: "System" },
];

export function Sidebar({ useQueue = false }: { useQueue?: boolean }) {
  const pathname = usePathname();

  const ungrouped = NAV.filter((i) => !i.group);
  const grouped = NAV.filter((i) => i.group);
  const groups = Array.from(new Set(grouped.map((i) => i.group)));

  function NavLink({ item }: { item: NavItem }) {
    const active = pathname === item.href || pathname.startsWith(item.href + "/");
    return (
      <Link
        href={item.href}
        className={cn(
          "group flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
          active
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
        )}
      >
        <item.icon className="h-4 w-4 shrink-0" />
        {item.label}
        {active && <ChevronRight className="ml-auto h-3.5 w-3.5 opacity-60" />}
      </Link>
    );
  }

  return (
    <aside className="flex h-screen w-56 shrink-0 flex-col border-r bg-background">
      {/* Logo */}
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <Building2 className="h-5 w-5 text-primary" />
        <span className="font-semibold tracking-tight">PlanBased</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {ungrouped.map((item) => (
          <NavLink key={item.href} item={item} />
        ))}

        {groups.map((group) => (
          <div key={group} className="pt-4">
            <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {group}
            </p>
            {grouped
              .filter((i) => i.group === group)
              .map((item) => (
                <NavLink key={item.href} item={item} />
              ))}
          </div>
        ))}
      </nav>

      {/* Queue status indicator */}
      <div className="border-t p-3">
        <div
          className={cn(
            "flex items-center gap-2 rounded-md px-3 py-2 text-xs font-medium",
            useQueue
              ? "bg-emerald-50 text-emerald-700"
              : "bg-muted text-muted-foreground"
          )}
          title={useQueue ? "USE_QUEUE=true — Railway worker active" : "USE_QUEUE=false — pipeline runs inline on Vercel (300s limit)"}
        >
          <span className="relative flex h-2 w-2 shrink-0">
            {useQueue && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            )}
            <span
              className={cn(
                "relative inline-flex h-2 w-2 rounded-full",
                useQueue ? "bg-emerald-500" : "bg-muted-foreground/40"
              )}
            />
          </span>
          {useQueue ? "Queue ON" : "Direct mode"}
        </div>
      </div>
    </aside>
  );
}
