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
  { label: "New Estimation", href: "/estimation/new", icon: PlusCircle },
  { label: "Dossiers", href: "/admin/dossiers", icon: FolderOpen, group: "Admin" },
  { label: "Settings", href: "/admin/settings", icon: Settings, group: "Admin" },
];

export function Sidebar() {
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
        <span className="font-semibold tracking-tight">BuildCost</span>
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
    </aside>
  );
}
