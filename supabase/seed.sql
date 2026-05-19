-- Dev tenant for local development.
-- Required when NEXT_PUBLIC_SKIP_AUTH=true so foreign key references resolve.
-- Run once via Supabase Studio → SQL Editor.

INSERT INTO tenants (id, name, slug)
VALUES ('00000000-0000-0000-0000-000000000001', 'Dev Tenant', 'dev')
ON CONFLICT DO NOTHING;
