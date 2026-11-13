-- ============================================================
-- 010_cloud_business_foreign_key_indexes.sql
-- Covering indexes for FK / audit columns on cloud business tables
-- (Performance Advisor / sequential scan reduction).
-- ============================================================
-- Safe to re-run: CREATE INDEX IF NOT EXISTS only.
-- Does NOT alter table data, RLS, grants, or triggers.
-- Does NOT apply to Staging/Production from this PR alone.
-- Depends on: 20261112121112_cloud_business_data_foundation_009
-- ============================================================

-- properties
CREATE INDEX IF NOT EXISTS idx_properties_created_by
  ON public.properties (created_by);
CREATE INDEX IF NOT EXISTS idx_properties_updated_by
  ON public.properties (updated_by);

-- clients
CREATE INDEX IF NOT EXISTS idx_clients_created_by
  ON public.clients (created_by);
CREATE INDEX IF NOT EXISTS idx_clients_updated_by
  ON public.clients (updated_by);

-- needs
CREATE INDEX IF NOT EXISTS idx_needs_created_by
  ON public.needs (created_by);
CREATE INDEX IF NOT EXISTS idx_needs_updated_by
  ON public.needs (updated_by);

-- follow_ups (property_id is a simple FK; org/client already indexed in 009)
CREATE INDEX IF NOT EXISTS idx_follow_ups_created_by
  ON public.follow_ups (created_by);
CREATE INDEX IF NOT EXISTS idx_follow_ups_updated_by
  ON public.follow_ups (updated_by);
CREATE INDEX IF NOT EXISTS idx_follow_ups_property_id
  ON public.follow_ups (property_id);

-- activities (append-only; created_by is the only audit FK)
CREATE INDEX IF NOT EXISTS idx_activities_created_by
  ON public.activities (created_by);

-- ============================================================
-- End of 010_cloud_business_foreign_key_indexes.sql
-- ============================================================
