import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "yahoo.co.uk",
  "icloud.com",
  "me.com",
  "proton.me",
  "protonmail.com",
]);

function slugFromEmail(email: string): { slug: string; name: string } {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";

  if (!domain || PERSONAL_EMAIL_DOMAINS.has(domain)) {
    return {
      slug: `personal-${randomUUID()}`,
      name: "Personal workspace",
    };
  }

  const slug = domain.replace(/\./g, "-");
  const name = domain.split(".")[0];
  return {
    slug,
    name: name.charAt(0).toUpperCase() + name.slice(1),
  };
}

export async function ensureTenantAndUser(
  admin: SupabaseClient,
  authUser: { id: string; email: string }
) {
  const existing = await admin
    .from("users")
    .select("id, tenant_id")
    .eq("id", authUser.id)
    .maybeSingle();

  if (existing.data?.tenant_id) {
    return { tenantId: existing.data.tenant_id, isNew: false };
  }

  const { slug, name } = slugFromEmail(authUser.email);

  const existingTenant = await admin
    .from("tenants")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();

  let tenantId = existingTenant.data?.id as string | undefined;

  if (!tenantId) {
    const inserted = await admin
      .from("tenants")
      .insert({ slug, name })
      .select("id")
      .single();
    if (inserted.error) throw inserted.error;
    tenantId = inserted.data.id;
  }

  const role = existingTenant.data ? "user" : "admin";

  const { error: userErr } = await admin.from("users").upsert(
    {
      id: authUser.id,
      tenant_id: tenantId,
      email: authUser.email,
      role,
    },
    { onConflict: "id" }
  );
  if (userErr) throw userErr;

  return { tenantId, isNew: true };
}
