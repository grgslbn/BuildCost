-- Add 'customer' to the users_role_check constraint.
-- The invite route sets role = 'customer' for tenant users, but the original
-- constraint only allowed 'admin', 'user', 'viewer', causing profile creation
-- to fail with a check constraint violation.

ALTER TABLE public.users
  DROP CONSTRAINT users_role_check,
  ADD CONSTRAINT users_role_check
    CHECK (role = ANY (ARRAY['admin'::text, 'user'::text, 'viewer'::text, 'customer'::text]));
