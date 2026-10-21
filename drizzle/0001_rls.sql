-- Tenant isolation with PostgreSQL row-level security.
--
-- Requests on behalf of a studio run inside a transaction that does
--   SELECT set_config('app.studio_id', '<uuid>', true); SET LOCAL ROLE wf_app;
-- wf_app is a NOLOGIN role without BYPASSRLS, so every query it runs is filtered
-- by the policies below. Background workers and platform administration use the
-- owning role directly and must filter by studio_id explicitly.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wf_app') THEN
    CREATE ROLE wf_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint
-- Allow the migrating (owner) role to switch into wf_app (needed on managed Postgres such as Supabase).
DO $$
BEGIN
  EXECUTE format('GRANT wf_app TO %I', current_user);
EXCEPTION WHEN others THEN
  RAISE NOTICE 'Could not grant wf_app to %: %', current_user, SQLERRM;
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION wf.current_studio_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.studio_id', true), '')::uuid $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA wf TO wf_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION wf.current_studio_id() TO wf_app;
--> statement-breakpoint
DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'studio_members', 'studio_invites', 'services', 'leads', 'consents', 'activities', 'tasks',
    'calendar_entries', 'date_availability', 'message_templates', 'messages', 'quotations',
    'quotation_items', 'automation_rules', 'automation_runs', 'jobs', 'ai_insights', 'ai_usage',
    'studio_integrations', 'notifications'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE wf.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON wf.%I TO wf_app', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON wf.%I TO wf_app USING (studio_id = wf.current_studio_id()) WITH CHECK (studio_id = wf.current_studio_id())',
      t
    );
  END LOOP;
END
$$;
--> statement-breakpoint
-- Audit log: studios may read and append their own entries but never change them.
ALTER TABLE wf.audit_logs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT ON wf.audit_logs TO wf_app;
--> statement-breakpoint
CREATE POLICY tenant_read ON wf.audit_logs FOR SELECT TO wf_app USING (studio_id = wf.current_studio_id());
--> statement-breakpoint
CREATE POLICY tenant_append ON wf.audit_logs FOR INSERT TO wf_app WITH CHECK (studio_id = wf.current_studio_id());
--> statement-breakpoint
-- Studios: a studio context can see and update only its own row.
ALTER TABLE wf.studios ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, UPDATE ON wf.studios TO wf_app;
--> statement-breakpoint
CREATE POLICY own_studio_read ON wf.studios FOR SELECT TO wf_app USING (id = wf.current_studio_id());
--> statement-breakpoint
CREATE POLICY own_studio_update ON wf.studios FOR UPDATE TO wf_app USING (id = wf.current_studio_id()) WITH CHECK (id = wf.current_studio_id());
--> statement-breakpoint
-- Profiles: visible only for members of the current studio.
ALTER TABLE wf.profiles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT ON wf.profiles TO wf_app;
--> statement-breakpoint
CREATE POLICY studio_member_profiles ON wf.profiles FOR SELECT TO wf_app
  USING (id IN (SELECT user_id FROM wf.studio_members WHERE studio_id = wf.current_studio_id()));
--> statement-breakpoint
-- Platform-only tables: RLS enabled with no wf_app policy or grant.
ALTER TABLE wf.local_auth_users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE wf.webhook_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE wf.support_notes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE wf.rate_limits ENABLE ROW LEVEL SECURITY;
