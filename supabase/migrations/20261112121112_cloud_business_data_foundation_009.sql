-- ============================================================
-- 009_cloud_business_data_foundation.sql
-- Create multi-tenant cloud tables for properties, clients, needs,
-- follow_ups, and activities. Align columns with src/types (Dexie models)
-- plus organization_id / audit columns required for cloud tenancy.
-- ============================================================
-- Does NOT migrate IndexedDB/Dexie data.
-- Does NOT connect application repositories to Supabase.
-- Does NOT alter invitation RPCs or membership structure.
-- Depends on: organizations, private.user_organization_ids() (migration 008).
-- Remote version on etehad-staging: 20261112121112
-- ============================================================

DO $$ BEGIN
  CREATE TYPE public.transaction_type AS ENUM ('sale', 'rent');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.property_type AS ENUM ('apartment', 'house', 'land', 'shop', 'office', 'other');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.follow_up_status AS ENUM ('pending', 'completed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.activity_type AS ENUM ('property', 'client', 'need', 'followup');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION private.prevent_organization_id_change()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'organization_id cannot be changed after create' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.prevent_organization_id_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.prevent_organization_id_change() FROM anon;
REVOKE ALL ON FUNCTION private.prevent_organization_id_change() FROM authenticated;

CREATE OR REPLACE FUNCTION private.prevent_created_by_change()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'created_by cannot be changed after create' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.prevent_created_by_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.prevent_created_by_change() FROM anon;
REVOKE ALL ON FUNCTION private.prevent_created_by_change() FROM authenticated;

CREATE OR REPLACE FUNCTION private.follow_ups_property_same_org()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_prop_org uuid;
BEGIN
  IF NEW.property_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT p.organization_id INTO v_prop_org FROM public.properties AS p WHERE p.id = NEW.property_id;
  IF v_prop_org IS NULL THEN
    RAISE EXCEPTION 'follow_ups.property_id must reference an existing property' USING ERRCODE = '23503';
  END IF;
  IF v_prop_org IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'follow_ups.property_id must belong to the same organization' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.follow_ups_property_same_org() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.follow_ups_property_same_org() FROM anon;
REVOKE ALL ON FUNCTION private.follow_ups_property_same_org() FROM authenticated;

CREATE TABLE IF NOT EXISTS public.properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  transaction_type public.transaction_type NOT NULL DEFAULT 'sale',
  property_type public.property_type NOT NULL DEFAULT 'other',
  area numeric NULL,
  bedrooms integer NULL,
  location text NOT NULL DEFAULT '',
  neighborhood text NOT NULL DEFAULT '',
  price bigint NULL,
  deposit bigint NULL,
  rent bigint NULL,
  floor integer NULL,
  total_floors integer NULL,
  parking boolean NULL,
  elevator boolean NULL,
  storage boolean NULL,
  description text NOT NULL DEFAULT '',
  contact_name text NOT NULL DEFAULT '',
  contact_phone text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES auth.users (id),
  updated_by uuid NOT NULL REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT properties_org_id_unique UNIQUE (organization_id, id)
);

CREATE INDEX IF NOT EXISTS idx_properties_organization_id ON public.properties (organization_id);
CREATE INDEX IF NOT EXISTS idx_properties_org_updated_at ON public.properties (organization_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  tags text[] NOT NULL DEFAULT '{}'::text[],
  created_by uuid NOT NULL REFERENCES auth.users (id),
  updated_by uuid NOT NULL REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clients_org_id_unique UNIQUE (organization_id, id)
);

CREATE INDEX IF NOT EXISTS idx_clients_organization_id ON public.clients (organization_id);
CREATE INDEX IF NOT EXISTS idx_clients_org_updated_at ON public.clients (organization_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.needs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  transaction_type public.transaction_type NOT NULL DEFAULT 'sale',
  property_type public.property_type NULL,
  min_area numeric NULL,
  max_area numeric NULL,
  bedrooms integer NULL,
  location text NOT NULL DEFAULT '',
  max_price bigint NULL,
  max_deposit bigint NULL,
  max_rent bigint NULL,
  notes text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES auth.users (id),
  updated_by uuid NOT NULL REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT needs_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT needs_client_same_org_fkey
    FOREIGN KEY (organization_id, client_id)
    REFERENCES public.clients (organization_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_needs_organization_id ON public.needs (organization_id);
CREATE INDEX IF NOT EXISTS idx_needs_client_id ON public.needs (organization_id, client_id);

CREATE TABLE IF NOT EXISTS public.follow_ups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  client_id uuid NOT NULL,
  property_id uuid NULL,
  due_date date NOT NULL DEFAULT (CURRENT_DATE),
  status public.follow_up_status NOT NULL DEFAULT 'pending',
  notes text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES auth.users (id),
  updated_by uuid NOT NULL REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT follow_ups_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT follow_ups_client_same_org_fkey
    FOREIGN KEY (organization_id, client_id)
    REFERENCES public.clients (organization_id, id)
    ON DELETE CASCADE,
  CONSTRAINT follow_ups_property_id_fkey
    FOREIGN KEY (property_id)
    REFERENCES public.properties (id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_follow_ups_organization_id ON public.follow_ups (organization_id);
CREATE INDEX IF NOT EXISTS idx_follow_ups_client_id ON public.follow_ups (organization_id, client_id);
CREATE INDEX IF NOT EXISTS idx_follow_ups_due_date ON public.follow_ups (organization_id, due_date, status);

CREATE TABLE IF NOT EXISTS public.activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  type public.activity_type NOT NULL,
  text text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT activities_org_id_unique UNIQUE (organization_id, id)
);

CREATE INDEX IF NOT EXISTS idx_activities_organization_id ON public.activities (organization_id);
CREATE INDEX IF NOT EXISTS idx_activities_org_created_at ON public.activities (organization_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_properties_org_immutable ON public.properties;
CREATE TRIGGER trg_properties_org_immutable BEFORE UPDATE ON public.properties
  FOR EACH ROW EXECUTE PROCEDURE private.prevent_organization_id_change();
DROP TRIGGER IF EXISTS trg_properties_created_by_immutable ON public.properties;
CREATE TRIGGER trg_properties_created_by_immutable BEFORE UPDATE ON public.properties
  FOR EACH ROW EXECUTE PROCEDURE private.prevent_created_by_change();

DROP TRIGGER IF EXISTS trg_clients_org_immutable ON public.clients;
CREATE TRIGGER trg_clients_org_immutable BEFORE UPDATE ON public.clients
  FOR EACH ROW EXECUTE PROCEDURE private.prevent_organization_id_change();
DROP TRIGGER IF EXISTS trg_clients_created_by_immutable ON public.clients;
CREATE TRIGGER trg_clients_created_by_immutable BEFORE UPDATE ON public.clients
  FOR EACH ROW EXECUTE PROCEDURE private.prevent_created_by_change();

DROP TRIGGER IF EXISTS trg_needs_org_immutable ON public.needs;
CREATE TRIGGER trg_needs_org_immutable BEFORE UPDATE ON public.needs
  FOR EACH ROW EXECUTE PROCEDURE private.prevent_organization_id_change();
DROP TRIGGER IF EXISTS trg_needs_created_by_immutable ON public.needs;
CREATE TRIGGER trg_needs_created_by_immutable BEFORE UPDATE ON public.needs
  FOR EACH ROW EXECUTE PROCEDURE private.prevent_created_by_change();

DROP TRIGGER IF EXISTS trg_follow_ups_org_immutable ON public.follow_ups;
CREATE TRIGGER trg_follow_ups_org_immutable BEFORE UPDATE ON public.follow_ups
  FOR EACH ROW EXECUTE PROCEDURE private.prevent_organization_id_change();
DROP TRIGGER IF EXISTS trg_follow_ups_created_by_immutable ON public.follow_ups;
CREATE TRIGGER trg_follow_ups_created_by_immutable BEFORE UPDATE ON public.follow_ups
  FOR EACH ROW EXECUTE PROCEDURE private.prevent_created_by_change();
DROP TRIGGER IF EXISTS trg_follow_ups_property_same_org ON public.follow_ups;
CREATE TRIGGER trg_follow_ups_property_same_org
  BEFORE INSERT OR UPDATE OF property_id, organization_id ON public.follow_ups
  FOR EACH ROW EXECUTE PROCEDURE private.follow_ups_property_same_org();

DROP TRIGGER IF EXISTS trg_activities_org_immutable ON public.activities;
CREATE TRIGGER trg_activities_org_immutable BEFORE UPDATE ON public.activities
  FOR EACH ROW EXECUTE PROCEDURE private.prevent_organization_id_change();
DROP TRIGGER IF EXISTS trg_activities_created_by_immutable ON public.activities;
CREATE TRIGGER trg_activities_created_by_immutable BEFORE UPDATE ON public.activities
  FOR EACH ROW EXECUTE PROCEDURE private.prevent_created_by_change();

ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.needs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.follow_ups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant isolation for properties" ON public.properties;
DROP POLICY IF EXISTS "Tenant isolation for clients" ON public.clients;
DROP POLICY IF EXISTS "Tenant isolation for needs" ON public.needs;
DROP POLICY IF EXISTS "Tenant isolation for follow_ups" ON public.follow_ups;
DROP POLICY IF EXISTS "Tenant isolation for activities" ON public.activities;

CREATE POLICY "properties_select_member" ON public.properties FOR SELECT TO authenticated
  USING (organization_id IN (SELECT private.user_organization_ids()));
CREATE POLICY "properties_insert_member" ON public.properties FOR INSERT TO authenticated
  WITH CHECK (organization_id IN (SELECT private.user_organization_ids()) AND created_by = (SELECT auth.uid()) AND updated_by = (SELECT auth.uid()));
CREATE POLICY "properties_update_member" ON public.properties FOR UPDATE TO authenticated
  USING (organization_id IN (SELECT private.user_organization_ids()))
  WITH CHECK (organization_id IN (SELECT private.user_organization_ids()) AND updated_by = (SELECT auth.uid()));
CREATE POLICY "properties_delete_member" ON public.properties FOR DELETE TO authenticated
  USING (organization_id IN (SELECT private.user_organization_ids()));

CREATE POLICY "clients_select_member" ON public.clients FOR SELECT TO authenticated
  USING (organization_id IN (SELECT private.user_organization_ids()));
CREATE POLICY "clients_insert_member" ON public.clients FOR INSERT TO authenticated
  WITH CHECK (organization_id IN (SELECT private.user_organization_ids()) AND created_by = (SELECT auth.uid()) AND updated_by = (SELECT auth.uid()));
CREATE POLICY "clients_update_member" ON public.clients FOR UPDATE TO authenticated
  USING (organization_id IN (SELECT private.user_organization_ids()))
  WITH CHECK (organization_id IN (SELECT private.user_organization_ids()) AND updated_by = (SELECT auth.uid()));
CREATE POLICY "clients_delete_member" ON public.clients FOR DELETE TO authenticated
  USING (organization_id IN (SELECT private.user_organization_ids()));

CREATE POLICY "needs_select_member" ON public.needs FOR SELECT TO authenticated
  USING (organization_id IN (SELECT private.user_organization_ids()));
CREATE POLICY "needs_insert_member" ON public.needs FOR INSERT TO authenticated
  WITH CHECK (organization_id IN (SELECT private.user_organization_ids()) AND created_by = (SELECT auth.uid()) AND updated_by = (SELECT auth.uid()));
CREATE POLICY "needs_update_member" ON public.needs FOR UPDATE TO authenticated
  USING (organization_id IN (SELECT private.user_organization_ids()))
  WITH CHECK (organization_id IN (SELECT private.user_organization_ids()) AND updated_by = (SELECT auth.uid()));
CREATE POLICY "needs_delete_member" ON public.needs FOR DELETE TO authenticated
  USING (organization_id IN (SELECT private.user_organization_ids()));

CREATE POLICY "follow_ups_select_member" ON public.follow_ups FOR SELECT TO authenticated
  USING (organization_id IN (SELECT private.user_organization_ids()));
CREATE POLICY "follow_ups_insert_member" ON public.follow_ups FOR INSERT TO authenticated
  WITH CHECK (organization_id IN (SELECT private.user_organization_ids()) AND created_by = (SELECT auth.uid()) AND updated_by = (SELECT auth.uid()));
CREATE POLICY "follow_ups_update_member" ON public.follow_ups FOR UPDATE TO authenticated
  USING (organization_id IN (SELECT private.user_organization_ids()))
  WITH CHECK (organization_id IN (SELECT private.user_organization_ids()) AND updated_by = (SELECT auth.uid()));
CREATE POLICY "follow_ups_delete_member" ON public.follow_ups FOR DELETE TO authenticated
  USING (organization_id IN (SELECT private.user_organization_ids()));

CREATE POLICY "activities_select_member" ON public.activities FOR SELECT TO authenticated
  USING (organization_id IN (SELECT private.user_organization_ids()));
CREATE POLICY "activities_insert_member" ON public.activities FOR INSERT TO authenticated
  WITH CHECK (organization_id IN (SELECT private.user_organization_ids()) AND created_by = (SELECT auth.uid()));

REVOKE ALL ON TABLE public.properties FROM PUBLIC;
REVOKE ALL ON TABLE public.properties FROM anon;
REVOKE ALL ON TABLE public.properties FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.properties TO authenticated;

REVOKE ALL ON TABLE public.clients FROM PUBLIC;
REVOKE ALL ON TABLE public.clients FROM anon;
REVOKE ALL ON TABLE public.clients FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.clients TO authenticated;

REVOKE ALL ON TABLE public.needs FROM PUBLIC;
REVOKE ALL ON TABLE public.needs FROM anon;
REVOKE ALL ON TABLE public.needs FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.needs TO authenticated;

REVOKE ALL ON TABLE public.follow_ups FROM PUBLIC;
REVOKE ALL ON TABLE public.follow_ups FROM anon;
REVOKE ALL ON TABLE public.follow_ups FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.follow_ups TO authenticated;

REVOKE ALL ON TABLE public.activities FROM PUBLIC;
REVOKE ALL ON TABLE public.activities FROM anon;
REVOKE ALL ON TABLE public.activities FROM authenticated;
GRANT SELECT, INSERT ON TABLE public.activities TO authenticated;
