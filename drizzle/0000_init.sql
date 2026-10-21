CREATE SCHEMA "wf";
--> statement-breakpoint
CREATE TYPE "wf"."actor_type" AS ENUM('user', 'system', 'automation', 'client', 'ai', 'platform_admin');--> statement-breakpoint
CREATE TYPE "wf"."automation_run_status" AS ENUM('scheduled', 'running', 'completed', 'dry_run', 'skipped', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "wf"."automation_trigger" AS ENUM('lead_created', 'lead_status_changed', 'follow_up_due', 'consultation_approaching', 'quotation_created', 'quotation_awaiting_response', 'event_date_approaching', 'lead_inactive', 'booking_confirmed', 'client_opted_out');--> statement-breakpoint
CREATE TYPE "wf"."calendar_entry_type" AS ENUM('wedding_event', 'consultation', 'quotation_expiry', 'tentative_hold', 'confirmed_booking', 'blocked');--> statement-breakpoint
CREATE TYPE "wf"."channel" AS ENUM('whatsapp', 'email');--> statement-breakpoint
CREATE TYPE "wf"."direction" AS ENUM('outbound', 'inbound');--> statement-breakpoint
CREATE TYPE "wf"."job_status" AS ENUM('pending', 'running', 'completed', 'failed', 'dead', 'cancelled');--> statement-breakpoint
CREATE TYPE "wf"."lead_status" AS ENUM('new_enquiry', 'contact_attempted', 'contacted', 'qualified', 'consultation_scheduled', 'quotation_sent', 'negotiation', 'tentative_hold', 'booking_confirmed', 'won', 'lost', 'not_interested');--> statement-breakpoint
CREATE TYPE "wf"."member_role" AS ENUM('owner', 'admin', 'staff', 'viewer');--> statement-breakpoint
CREATE TYPE "wf"."message_status" AS ENUM('draft', 'awaiting_approval', 'queued', 'sending', 'sent', 'delivered', 'failed', 'cancelled', 'skipped');--> statement-breakpoint
CREATE TYPE "wf"."priority" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "wf"."quotation_status" AS ENUM('draft', 'approved', 'sent', 'accepted', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "wf"."task_status" AS ENUM('open', 'done', 'cancelled');--> statement-breakpoint
CREATE TYPE "wf"."task_type" AS ENUM('follow_up', 'call', 'consultation', 'review', 'general');--> statement-breakpoint
CREATE TABLE "wf"."activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"lead_id" uuid,
	"actor_type" "wf"."actor_type" NOT NULL,
	"actor_id" uuid,
	"type" text NOT NULL,
	"summary" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wf"."ai_insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"lead_id" uuid,
	"kind" text NOT NULL,
	"content" jsonb NOT NULL,
	"model" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wf"."ai_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid,
	"user_id" uuid,
	"feature" text NOT NULL,
	"provider" text NOT NULL,
	"model" text,
	"status" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wf"."audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid,
	"actor_user_id" uuid,
	"actor_type" "wf"."actor_type" NOT NULL,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"ip_hash" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wf"."automation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"trigger" "wf"."automation_trigger" NOT NULL,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"delay_minutes" integer DEFAULT 0 NOT NULL,
	"delay_business_days" integer DEFAULT 0 NOT NULL,
	"respect_business_hours" boolean DEFAULT true NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"dry_run" boolean DEFAULT false NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wf"."automation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"lead_id" uuid,
	"trigger_key" text NOT NULL,
	"status" "wf"."automation_run_status" DEFAULT 'scheduled' NOT NULL,
	"dry_run" boolean DEFAULT false NOT NULL,
	"depth" integer DEFAULT 0 NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"result" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"skip_reason" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wf"."calendar_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"lead_id" uuid,
	"quotation_id" uuid,
	"type" "wf"."calendar_entry_type" NOT NULL,
	"title" text NOT NULL,
	"entry_date" date NOT NULL,
	"start_time" time,
	"end_time" time,
	"notes" text,
	"reminder_sent_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wf"."consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"kind" text DEFAULT 'contact' NOT NULL,
	"granted" boolean NOT NULL,
	"text" text NOT NULL,
	"source" text NOT NULL,
	"ip_hash" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wf"."date_availability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"date" date NOT NULL,
	"state" text NOT NULL,
	"note" text,
	"set_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wf"."jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "wf"."job_status" DEFAULT 'pending' NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"idempotency_key" text,
	"last_error" text,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "wf"."leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"contact_name" text NOT NULL,
	"partner_name" text,
	"phone" text NOT NULL,
	"email" text,
	"event_type" text NOT NULL,
	"event_date" date,
	"additional_dates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"city" text,
	"venue" text,
	"service_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"budget_range" text,
	"message" text,
	"preferred_channel" text DEFAULT 'any' NOT NULL,
	"source" text DEFAULT 'website_form' NOT NULL,
	"source_detail" text,
	"status" "wf"."lead_status" DEFAULT 'new_enquiry' NOT NULL,
	"priority" "wf"."priority",
	"priority_reason" text,
	"assigned_to" uuid,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"next_action" text,
	"next_action_at" timestamp with time zone,
	"quotation_amount_minor" bigint,
	"deposit_recorded_at" timestamp with time zone,
	"deposit_amount_minor" bigint,
	"revenue_minor" bigint,
	"lost_reason" text,
	"first_contacted_at" timestamp with time zone,
	"last_contacted_at" timestamp with time zone,
	"last_inbound_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"consent_contact" boolean DEFAULT false NOT NULL,
	"consent_at" timestamp with time zone,
	"opted_out" boolean DEFAULT false NOT NULL,
	"opted_out_at" timestamp with time zone,
	"possible_duplicate_of" uuid,
	"ai_summary" jsonb,
	"ai_summary_at" timestamp with time zone,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wf"."local_auth_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "local_auth_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "wf"."message_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"name" text NOT NULL,
	"channel" "wf"."channel" NOT NULL,
	"purpose" text DEFAULT 'general' NOT NULL,
	"whatsapp_template_name" text,
	"language" text DEFAULT 'en' NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"approved" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wf"."messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"channel" "wf"."channel" NOT NULL,
	"direction" "wf"."direction" DEFAULT 'outbound' NOT NULL,
	"status" "wf"."message_status" DEFAULT 'draft' NOT NULL,
	"template_id" uuid,
	"whatsapp_template_name" text,
	"template_params" jsonb,
	"subject" text,
	"body" text NOT NULL,
	"to_address" text,
	"provider" text,
	"provider_message_id" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"ai_generated" boolean DEFAULT false NOT NULL,
	"purpose" text DEFAULT 'general' NOT NULL,
	"error" text,
	"skip_reason" text,
	"created_by_type" "wf"."actor_type" DEFAULT 'user' NOT NULL,
	"created_by" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"queued_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"content_hash" text,
	"automation_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wf"."notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"user_id" uuid,
	"lead_id" uuid,
	"title" text NOT NULL,
	"body" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wf"."profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"full_name" text,
	"is_platform_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "wf"."quotation_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"quotation_id" uuid NOT NULL,
	"service_id" uuid,
	"description" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price_minor" bigint NOT NULL,
	"line_total_minor" bigint NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wf"."quotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"number" text NOT NULL,
	"status" "wf"."quotation_status" DEFAULT 'draft' NOT NULL,
	"title" text NOT NULL,
	"client_name" text NOT NULL,
	"client_email" text,
	"client_phone" text,
	"event_summary" text,
	"event_date" date,
	"valid_until" date,
	"currency" text DEFAULT 'INR' NOT NULL,
	"discount_type" text DEFAULT 'none' NOT NULL,
	"discount_value" bigint DEFAULT 0 NOT NULL,
	"tax_rate_bps" integer DEFAULT 0 NOT NULL,
	"tax_label" text DEFAULT 'Tax' NOT NULL,
	"subtotal_minor" bigint DEFAULT 0 NOT NULL,
	"discount_minor" bigint DEFAULT 0 NOT NULL,
	"tax_minor" bigint DEFAULT 0 NOT NULL,
	"total_minor" bigint DEFAULT 0 NOT NULL,
	"deposit_type" text DEFAULT 'percent' NOT NULL,
	"deposit_value" bigint DEFAULT 0 NOT NULL,
	"deposit_minor" bigint DEFAULT 0 NOT NULL,
	"milestones" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"terms" text,
	"internal_notes" text,
	"ai_assisted" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"awaiting_notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wf"."rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wf"."services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text DEFAULT 'photography' NOT NULL,
	"unit" text DEFAULT 'per_event' NOT NULL,
	"price_minor" bigint,
	"active" boolean DEFAULT true NOT NULL,
	"show_on_form" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wf"."studio_integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"status" text DEFAULT 'not_configured' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secret_encrypted" text,
	"last_verified_at" timestamp with time zone,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wf"."studio_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "wf"."member_role" DEFAULT 'staff' NOT NULL,
	"invited_by" uuid,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wf"."studio_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "wf"."member_role" DEFAULT 'staff' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wf"."studios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"business_type" text DEFAULT 'photo_video' NOT NULL,
	"email" text,
	"phone" text,
	"city" text,
	"website" text,
	"logo_url" text,
	"brand_color" text DEFAULT '#b08d57' NOT NULL,
	"welcome_message" text,
	"privacy_notice" text,
	"currency" text DEFAULT 'INR' NOT NULL,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"automation_paused" boolean DEFAULT false NOT NULL,
	"ai_enabled" boolean DEFAULT true NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"data_retention_days" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "studios_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "wf"."support_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"author_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wf"."tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"lead_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"type" "wf"."task_type" DEFAULT 'follow_up' NOT NULL,
	"status" "wf"."task_status" DEFAULT 'open' NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"assigned_to" uuid,
	"created_by_type" "wf"."actor_type" DEFAULT 'user' NOT NULL,
	"created_by" uuid,
	"automation_run_id" uuid,
	"completed_at" timestamp with time zone,
	"due_notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wf"."webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"event_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "wf"."activities" ADD CONSTRAINT "activities_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "wf"."studios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wf"."activities" ADD CONSTRAINT "activities_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "wf"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wf"."ai_insights" ADD CONSTRAINT "ai_insights_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "wf"."studios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wf"."ai_insights" ADD CONSTRAINT "ai_insights_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "wf"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wf"."ai_usage" ADD CONSTRAINT "ai_usage_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "wf"."studios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wf"."audit_logs" ADD CONSTRAINT "audit_logs_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "wf"."studios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wf"."automation_rules" ADD CONSTRAINT "automation_rules_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "wf"."studios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wf"."automation_runs" ADD CONSTRAINT "automation_runs_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "wf"."studios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wf"."automation_runs" ADD CONSTRAINT "automation_runs_rule_id_automation_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "wf"."automation_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wf"."automation_runs" ADD CONSTRAINT "automation_runs_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "wf"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wf"."calendar_entries" ADD CONSTRAINT "calendar_entries_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "wf"."studios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wf"."calendar_entries" ADD CONSTRAINT "calendar_entries_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "wf"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wf"."consents" ADD CONSTRAINT "consents_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "wf"."studios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wf"."consents" ADD CONSTRAINT "consents_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "wf"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wf"."date_availability" ADD CONSTRAINT "date_availability_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "wf"."studios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wf"."jobs" ADD CONSTRAINT "jobs_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "wf"."studios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wf"."leads" ADD CONSTRAINT "leads_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "wf"."studios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wf"."leads" ADD CONSTRAINT "leads_assigned_to_profiles_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "wf"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wf"."message_templates" ADD CONSTRAINT "message_templates_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "wf"."studios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wf"."messages" ADD CONSTRAINT "messages_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "wf"."studios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wf"."messages" ADD CONSTRAINT "messages_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "wf"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wf"."notifications" ADD CONSTRAINT "notifications_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "wf"."studios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wf"."notifications" ADD CONSTRAINT "notifications_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "wf"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wf"."quotation_items" ADD CONSTRAINT "quotation_items_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "wf"."studios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wf"."quotation_items" ADD CONSTRAINT "quotation_items_quotation_id_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "wf"."quotations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wf"."quotations" ADD CONSTRAINT "quotations_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "wf"."studios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wf"."quotations" ADD CONSTRAINT "quotations_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "wf"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wf"."services" ADD CONSTRAINT "services_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "wf"."studios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wf"."studio_integrations" ADD CONSTRAINT "studio_integrations_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "wf"."studios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wf"."studio_invites" ADD CONSTRAINT "studio_invites_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "wf"."studios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wf"."studio_invites" ADD CONSTRAINT "studio_invites_invited_by_profiles_id_fk" FOREIGN KEY ("invited_by") REFERENCES "wf"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wf"."studio_members" ADD CONSTRAINT "studio_members_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "wf"."studios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wf"."studio_members" ADD CONSTRAINT "studio_members_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "wf"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wf"."support_notes" ADD CONSTRAINT "support_notes_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "wf"."studios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wf"."tasks" ADD CONSTRAINT "tasks_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "wf"."studios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wf"."tasks" ADD CONSTRAINT "tasks_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "wf"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wf"."tasks" ADD CONSTRAINT "tasks_assigned_to_profiles_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "wf"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activities_studio_lead_idx" ON "wf"."activities" USING btree ("studio_id","lead_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_insights_lead_idx" ON "wf"."ai_insights" USING btree ("studio_id","lead_id","kind");--> statement-breakpoint
CREATE INDEX "ai_usage_studio_created_idx" ON "wf"."ai_usage" USING btree ("studio_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_studio_created_idx" ON "wf"."audit_logs" USING btree ("studio_id","created_at");--> statement-breakpoint
CREATE INDEX "automation_rules_studio_trigger_idx" ON "wf"."automation_rules" USING btree ("studio_id","trigger");--> statement-breakpoint
CREATE UNIQUE INDEX "automation_runs_rule_trigger_uq" ON "wf"."automation_runs" USING btree ("rule_id","trigger_key");--> statement-breakpoint
CREATE INDEX "automation_runs_studio_created_idx" ON "wf"."automation_runs" USING btree ("studio_id","created_at");--> statement-breakpoint
CREATE INDEX "calendar_studio_date_idx" ON "wf"."calendar_entries" USING btree ("studio_id","entry_date");--> statement-breakpoint
CREATE INDEX "consents_lead_idx" ON "wf"."consents" USING btree ("lead_id");--> statement-breakpoint
CREATE UNIQUE INDEX "date_availability_studio_date_uq" ON "wf"."date_availability" USING btree ("studio_id","date");--> statement-breakpoint
CREATE INDEX "jobs_pending_idx" ON "wf"."jobs" USING btree ("status","run_at");--> statement-breakpoint
CREATE INDEX "jobs_studio_idx" ON "wf"."jobs" USING btree ("studio_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "leads_studio_reference_uq" ON "wf"."leads" USING btree ("studio_id","reference");--> statement-breakpoint
CREATE INDEX "leads_studio_status_idx" ON "wf"."leads" USING btree ("studio_id","status");--> statement-breakpoint
CREATE INDEX "leads_studio_created_idx" ON "wf"."leads" USING btree ("studio_id","created_at");--> statement-breakpoint
CREATE INDEX "leads_studio_phone_idx" ON "wf"."leads" USING btree ("studio_id","phone");--> statement-breakpoint
CREATE INDEX "leads_studio_event_date_idx" ON "wf"."leads" USING btree ("studio_id","event_date");--> statement-breakpoint
CREATE INDEX "templates_studio_idx" ON "wf"."message_templates" USING btree ("studio_id");--> statement-breakpoint
CREATE INDEX "messages_studio_lead_idx" ON "wf"."messages" USING btree ("studio_id","lead_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_studio_status_idx" ON "wf"."messages" USING btree ("studio_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_provider_id_uq" ON "wf"."messages" USING btree ("provider","provider_message_id");--> statement-breakpoint
CREATE INDEX "notifications_studio_created_idx" ON "wf"."notifications" USING btree ("studio_id","created_at");--> statement-breakpoint
CREATE INDEX "quotation_items_quotation_idx" ON "wf"."quotation_items" USING btree ("quotation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quotations_studio_number_uq" ON "wf"."quotations" USING btree ("studio_id","number");--> statement-breakpoint
CREATE INDEX "quotations_lead_idx" ON "wf"."quotations" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "services_studio_idx" ON "wf"."services" USING btree ("studio_id");--> statement-breakpoint
CREATE UNIQUE INDEX "studio_integrations_uq" ON "wf"."studio_integrations" USING btree ("studio_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "studio_invites_studio_email_uq" ON "wf"."studio_invites" USING btree ("studio_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "studio_members_studio_user_uq" ON "wf"."studio_members" USING btree ("studio_id","user_id");--> statement-breakpoint
CREATE INDEX "studio_members_user_idx" ON "wf"."studio_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tasks_studio_status_due_idx" ON "wf"."tasks" USING btree ("studio_id","status","due_at");--> statement-breakpoint
CREATE INDEX "tasks_lead_idx" ON "wf"."tasks" USING btree ("lead_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_provider_key_uq" ON "wf"."webhook_events" USING btree ("provider","event_key");