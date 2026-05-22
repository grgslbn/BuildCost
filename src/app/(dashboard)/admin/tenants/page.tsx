"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Building2, Plus, Users, Mail, X } from "lucide-react";

type Tenant = {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  user_count: number;
};

type TenantUser = {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  invited_at: string | null;
  last_active_at: string | null;
  created_at: string;
};

function fmt(date: string | null) {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: "0.75rem",
          padding: "1.5rem",
          width: "100%",
          maxWidth: "420px",
          boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-base">{title}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function AdminTenantsPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createSlug, setCreateSlug] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
  const [tenantUsers, setTenantUsers] = useState<TenantUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState(false);

  async function loadTenants() {
    setLoading(true);
    const res = await fetch("/api/admin/tenants");
    const data = await res.json();
    setTenants(data.tenants ?? []);
    setLoading(false);
  }

  const loadTenantUsers = useCallback(async (tenantId: string) => {
    setUsersLoading(true);
    const res = await fetch(`/api/admin/tenants/${tenantId}/users`);
    const data = await res.json();
    setTenantUsers(data.users ?? []);
    setUsersLoading(false);
  }, []);

  useEffect(() => { loadTenants(); }, []);
  useEffect(() => {
    if (selectedTenant) loadTenantUsers(selectedTenant.id);
  }, [selectedTenant, loadTenantUsers]);

  function autoSlug(name: string) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    const res = await fetch("/api/admin/tenants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: createName, slug: createSlug }),
    });
    const data = await res.json();
    if (!res.ok) {
      setCreateError(data.error ?? "Failed to create tenant");
      setCreating(false);
      return;
    }
    setCreateOpen(false);
    setCreateName(""); setCreateSlug("");
    setCreating(false);
    loadTenants();
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedTenant) return;
    setInviting(true);
    setInviteError(null);
    const res = await fetch(`/api/admin/tenants/${selectedTenant.id}/invite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inviteEmail, full_name: inviteName || null }),
    });
    const data = await res.json();
    if (!res.ok) {
      setInviteError(data.error ?? "Failed to send invite");
      setInviting(false);
      return;
    }
    setInviteSuccess(true);
    setInviting(false);
    loadTenantUsers(selectedTenant.id);
    loadTenants();
    setTimeout(() => {
      setInviteOpen(false);
      setInviteEmail(""); setInviteName(""); setInviteSuccess(false);
    }, 2000);
  }

  return (
    <div className="flex h-full">
      {/* Tenant list */}
      <div className="w-72 shrink-0 border-r p-5 space-y-4 overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-sm">Tenants</h2>
          <Button size="sm" variant="outline" onClick={() => { setCreateOpen(true); setCreateError(null); }}>
            <Plus className="h-3.5 w-3.5 mr-1" />New
          </Button>
        </div>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : tenants.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tenants yet.</p>
        ) : (
          <div className="space-y-1">
            {tenants.map((t) => (
              <button
                key={t.id}
                onClick={() => setSelectedTenant(t)}
                className={`w-full text-left rounded-md px-3 py-2.5 text-sm transition-colors ${
                  selectedTenant?.id === t.id
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted"
                }`}
              >
                <div className="font-medium">{t.name}</div>
                <div className={`text-xs mt-0.5 ${selectedTenant?.id === t.id ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                  {t.slug} · {t.user_count} user{t.user_count !== 1 ? "s" : ""}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Tenant detail */}
      <div className="flex-1 p-6 overflow-y-auto">
        {!selectedTenant ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <div className="text-center space-y-2">
              <Building2 className="h-10 w-10 mx-auto opacity-30" />
              <p className="text-sm">Select a tenant to manage its users</p>
            </div>
          </div>
        ) : (
          <div className="space-y-6 max-w-3xl">
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-xl font-semibold">{selectedTenant.name}</h1>
                <p className="text-sm text-muted-foreground mt-0.5">
                  slug: <code className="text-xs bg-muted px-1 py-0.5 rounded">{selectedTenant.slug}</code>
                  {" · "}created {fmt(selectedTenant.created_at)}
                </p>
              </div>
              <Button onClick={() => { setInviteOpen(true); setInviteError(null); setInviteSuccess(false); }}>
                <Mail className="h-4 w-4 mr-2" />Invite user
              </Button>
            </div>
            <Separator />
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Users className="h-4 w-4 text-muted-foreground" />
                <h2 className="font-medium text-sm">Users ({selectedTenant.user_count})</h2>
              </div>
              {usersLoading ? (
                <p className="text-sm text-muted-foreground">Loading users…</p>
              ) : tenantUsers.length === 0 ? (
                <Card>
                  <CardContent className="py-8 text-center text-sm text-muted-foreground">
                    No users yet. Invite the first user to get started.
                  </CardContent>
                </Card>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Email</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Invited</TableHead>
                      <TableHead>Last active</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tenantUsers.map((u) => (
                      <TableRow key={u.id}>
                        <TableCell className="font-mono text-xs">{u.email}</TableCell>
                        <TableCell>{u.full_name ?? "—"}</TableCell>
                        <TableCell>
                          <Badge variant={u.role === "admin" ? "default" : "secondary"}>{u.role}</Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{fmt(u.invited_at ?? u.created_at)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{fmt(u.last_active_at)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Create tenant modal */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Create tenant">
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="tenant-name">Company name</Label>
            <Input
              id="tenant-name"
              placeholder="AXA Belgium"
              value={createName}
              onChange={(e) => { setCreateName(e.target.value); setCreateSlug(autoSlug(e.target.value)); }}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tenant-slug">Slug</Label>
            <Input
              id="tenant-slug"
              placeholder="axa-belgium"
              value={createSlug}
              onChange={(e) => setCreateSlug(e.target.value)}
              required
            />
          </div>
          {createError && <p className="text-sm text-destructive">{createError}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={creating}>{creating ? "Creating…" : "Create"}</Button>
          </div>
        </form>
      </Modal>

      {/* Invite user modal */}
      <Modal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title={`Invite user to ${selectedTenant?.name}`}
      >
        {inviteSuccess ? (
          <div className="py-6 text-center">
            <p className="text-sm font-medium text-green-600">Invite sent to {inviteEmail}!</p>
          </div>
        ) : (
          <form onSubmit={handleInvite} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="adjuster@axabelgium.be"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-name">Full name (optional)</Label>
              <Input
                id="invite-name"
                placeholder="Jan Janssen"
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
              />
            </div>
            {inviteError && <p className="text-sm text-destructive">{inviteError}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={inviting}>{inviting ? "Sending…" : "Send invite"}</Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
