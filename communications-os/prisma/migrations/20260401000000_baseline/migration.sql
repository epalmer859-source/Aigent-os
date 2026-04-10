-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."appointment_request_status" AS ENUM ('draft', 'accepted_from_customer', 'sent_to_admin', 'admin_approved', 'admin_denied', 'completed', 'superseded', 'canceled');

-- CreateEnum
CREATE TYPE "public"."appointment_status" AS ENUM ('booked', 'rescheduled', 'canceled', 'completed', 'no_show');

-- CreateEnum
CREATE TYPE "public"."audience_type" AS ENUM ('customer', 'internal');

-- CreateEnum
CREATE TYPE "public"."consent_status" AS ENUM ('implied_inbound', 'opted_out', 'resubscribed');

-- CreateEnum
CREATE TYPE "public"."conversation_primary_state" AS ENUM ('new_lead', 'lead_qualified', 'booking_in_progress', 'quote_sent', 'lead_followup_active', 'waiting_on_customer_details', 'waiting_on_photos', 'waiting_on_admin_quote', 'waiting_on_admin_scheduling', 'waiting_on_parts_confirmation', 'waiting_on_approval', 'booked', 'reschedule_in_progress', 'tech_assigned', 'en_route', 'job_in_progress', 'job_paused', 'job_completed', 'complaint_open', 'billing_dispute_open', 'safety_issue_open', 'legal_threat_open', 'incident_liability_open', 'insurance_review_open', 'permits_regulatory_review_open', 'vendor_dispute_open', 'restricted_topic_open', 'hostile_customer_open', 'human_takeover_active', 'resolved', 'closed_unqualified', 'closed_lost', 'closed_completed');

-- CreateEnum
CREATE TYPE "public"."dispatch_status" AS ENUM ('en_route', 'delayed', 'arrived', 'on_site');

-- CreateEnum
CREATE TYPE "public"."escalation_category" AS ENUM ('complaint', 'legal_threat', 'safety_issue', 'billing_dispute', 'insurance_issue', 'permit_regulatory_issue', 'hostile_customer', 'damage_liability_incident', 'vendor_dispute', 'restricted_topic', 'scope_dispute', 'contract_interpretation', 'blame_fault', 'internal_staff_issue');

-- CreateEnum
CREATE TYPE "public"."event_family" AS ENUM ('inbound', 'outbound', 'state_machine', 'admin_action', 'detector', 'scheduler', 'integration', 'system');

-- CreateEnum
CREATE TYPE "public"."industry" AS ENUM ('house_cleaning', 'commercial_cleaning', 'lawn_care', 'pressure_washing', 'junk_removal', 'painting', 'garage_door', 'landscaping', 'handyman', 'appliance_repair', 'tree_service', 'pool_service', 'window_cleaning', 'flooring', 'plumbing', 'hvac', 'electrical', 'auto_repair', 'carpet_cleaning', 'gutter_service', 'detailing');

-- CreateEnum
CREATE TYPE "public"."message_channel" AS ENUM ('sms', 'voice', 'email', 'web_chat', 'push', 'other');

-- CreateEnum
CREATE TYPE "public"."notification_type" AS ENUM ('safety_issue', 'legal_threat', 'complaint', 'scheduling_request', 'stale_item', 'quote_request', 'customer_message_during_takeover', 'job_complete', 'new_customer_message', 'approval_request', 'parts_request', 'recurring_appointment_created', 'urgent_service_request', 'ai_unavailable', 'calendar_deletion_pending', 'conversation_merged', 'customer_email_unsubscribed', 'customer_email_resubscribed');

-- CreateEnum
CREATE TYPE "public"."outbound_status" AS ENUM ('pending', 'deferred', 'claimed', 'sent', 'failed_retryable', 'failed_terminal', 'canceled');

-- CreateEnum
CREATE TYPE "public"."quote_status" AS ENUM ('intake_open', 'under_review', 'approved_to_send', 'sent', 'accepted', 'declined', 'superseded', 'withdrawn', 'expired');

-- CreateEnum
CREATE TYPE "public"."recurring_change_request_status" AS ENUM ('draft', 'accepted_from_customer', 'sent_to_admin', 'admin_approved', 'admin_denied', 'completed', 'superseded', 'canceled');

-- CreateEnum
CREATE TYPE "public"."recurring_change_request_type" AS ENUM ('cancel_service', 'skip_visit', 'reschedule_visit', 'change_frequency');

-- CreateEnum
CREATE TYPE "public"."source_actor" AS ENUM ('customer', 'ai', 'admin_team', 'owner', 'provider', 'system', 'worker');

-- CreateEnum
CREATE TYPE "public"."tag_source" AS ENUM ('detector', 'ai', 'admin_team', 'owner', 'system');

-- CreateEnum
CREATE TYPE "public"."user_role" AS ENUM ('owner', 'admin');

-- CreateTable
CREATE TABLE "public"."appointment_change_requests" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "business_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "appointment_id" UUID NOT NULL,
    "request_type" TEXT NOT NULL,
    "request_status" "public"."appointment_request_status" NOT NULL DEFAULT 'draft',
    "customer_reason" TEXT,
    "preferred_day_text" TEXT,
    "preferred_window_text" TEXT,
    "flexibility_notes" TEXT,
    "suppression_active" BOOLEAN NOT NULL DEFAULT false,
    "suppression_started_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appointment_change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."appointments" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "business_id" UUID NOT NULL,
    "conversation_id" UUID,
    "customer_id" UUID NOT NULL,
    "service_type" TEXT,
    "appointment_date" DATE NOT NULL,
    "appointment_time" TIME(6) NOT NULL,
    "duration_minutes" INTEGER,
    "address" TEXT,
    "technician_name" TEXT,
    "status" "public"."appointment_status" NOT NULL DEFAULT 'booked',
    "dispatch_status" "public"."dispatch_status",
    "access_notes" TEXT,
    "admin_notes" TEXT,
    "google_calendar_event_id" TEXT,
    "is_recurring" BOOLEAN NOT NULL DEFAULT false,
    "recurring_service_id" UUID,
    "pending_deletion_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "canceled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "urgency" TEXT NOT NULL DEFAULT 'normal',
    "review_followup_pending" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."approval_requests" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "business_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "customer_id" UUID,
    "request_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "ai_summary" TEXT,
    "admin_notes" TEXT,
    "decided_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ(6),

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."attachments" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "business_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "message_id" UUID,
    "file_url" TEXT NOT NULL,
    "file_type" TEXT,
    "file_name" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."business_config" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "business_id" UUID NOT NULL,
    "business_hours" JSONB NOT NULL,
    "holidays_closures" JSONB,
    "service_area_type" TEXT NOT NULL DEFAULT 'list',
    "service_area_list" JSONB,
    "service_area_radius_miles" INTEGER,
    "service_area_center_address" TEXT,
    "service_area_exclusions" JSONB,
    "services_offered" JSONB NOT NULL,
    "services_not_offered" JSONB,
    "owner_approval_job_types" JSONB,
    "appointment_types" JSONB,
    "same_day_booking_allowed" BOOLEAN NOT NULL DEFAULT false,
    "secondary_contacts" JSONB,
    "industry_answers" JSONB,
    "urgent_tab_categories" JSONB NOT NULL DEFAULT '["safety", "legal", "complaint", "scheduling", "stale"]',
    "notification_defaults" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "technicians" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "business_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."businesses" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "owner_user_id" UUID NOT NULL,
    "business_name" TEXT NOT NULL,
    "industry" "public"."industry" NOT NULL,
    "timezone" TEXT NOT NULL,
    "join_code" TEXT NOT NULL,
    "is_paused" BOOLEAN NOT NULL DEFAULT false,
    "pause_message" TEXT,
    "default_takeover_timer_seconds" INTEGER NOT NULL DEFAULT 604800,
    "google_review_link" TEXT,
    "preferred_phone_number" TEXT,
    "urgent_alert_phone" TEXT,
    "urgent_alert_email" TEXT,
    "ai_signoff_name" TEXT,
    "ai_tone_description" TEXT,
    "always_say" TEXT,
    "never_say" TEXT,
    "supported_languages" TEXT DEFAULT 'English',
    "multilingual_enabled" BOOLEAN NOT NULL DEFAULT false,
    "ai_call_answering_enabled" BOOLEAN NOT NULL DEFAULT true,
    "rough_estimate_mode_enabled" BOOLEAN NOT NULL DEFAULT false,
    "labor_pricing_method" TEXT,
    "payment_management_enabled" BOOLEAN NOT NULL DEFAULT true,
    "cancellation_policy" TEXT,
    "warranty_policy" TEXT,
    "payment_methods" TEXT,
    "emergency_rules" TEXT,
    "customer_prep" TEXT,
    "common_questions" TEXT,
    "typical_process" TEXT,
    "important_details" TEXT,
    "customer_philosophy" TEXT,
    "takeover_notification_message" TEXT,
    "quiet_hours_start" TIME(6) NOT NULL DEFAULT '22:00:00'::time without time zone,
    "quiet_hours_end" TIME(6) NOT NULL DEFAULT '06:00:00'::time without time zone,
    "quote_expiry_days" INTEGER NOT NULL DEFAULT 30,
    "auto_close_days" INTEGER NOT NULL DEFAULT 30,
    "onboarding_completed_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "slug" TEXT,

    CONSTRAINT "businesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."calendar_connections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "google_calendar_id" TEXT NOT NULL,
    "access_token" TEXT NOT NULL,
    "refresh_token" TEXT NOT NULL,
    "token_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calendar_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."calendar_sync_log" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "business_id" UUID NOT NULL,
    "appointment_id" UUID,
    "google_calendar_event_id" TEXT,
    "sync_direction" TEXT NOT NULL,
    "sync_action" TEXT NOT NULL,
    "before_snapshot" JSONB,
    "after_snapshot" JSONB,
    "is_destructive" BOOLEAN NOT NULL DEFAULT false,
    "grace_period_expires_at" TIMESTAMPTZ(6),
    "grace_period_undone" BOOLEAN NOT NULL DEFAULT false,
    "processed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calendar_sync_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."conversation_merges" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "business_id" UUID NOT NULL,
    "surviving_conversation_id" UUID NOT NULL,
    "absorbed_conversation_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "merge_reason" TEXT NOT NULL,
    "merge_confidence" TEXT NOT NULL,
    "merged_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_merges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."conversation_tags" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "conversation_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "tag_code" TEXT NOT NULL,
    "tag_source" "public"."tag_source" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6),
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "conversation_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."conversations" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "business_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "matter_key" TEXT NOT NULL,
    "primary_state" "public"."conversation_primary_state" NOT NULL,
    "prior_state" TEXT,
    "current_owner" TEXT NOT NULL DEFAULT 'ai',
    "current_workflow_step" TEXT,
    "secondary_tags" JSONB,
    "contact_handle" TEXT NOT NULL,
    "contact_display_name" TEXT,
    "channel" TEXT NOT NULL,
    "collected_service_address" TEXT,
    "cached_summary" TEXT,
    "summary_updated_at" TIMESTAMPTZ(6),
    "last_customer_message_id" UUID,
    "last_outbound_message_id" UUID,
    "last_customer_message_at" TIMESTAMPTZ(6),
    "last_ai_message_at" TIMESTAMPTZ(6),
    "last_admin_message_at" TIMESTAMPTZ(6),
    "last_state_change_at" TIMESTAMPTZ(6),
    "human_takeover_enabled_at" TIMESTAMPTZ(6),
    "human_takeover_disabled_at" TIMESTAMPTZ(6),
    "human_takeover_expires_at" TIMESTAMPTZ(6),
    "human_takeover_timer_seconds" INTEGER,
    "is_no_show" BOOLEAN NOT NULL DEFAULT false,
    "auto_close_at" TIMESTAMPTZ(6),
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "closed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."customer_contacts" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "customer_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "contact_type" TEXT NOT NULL,
    "contact_value" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "is_opted_out" BOOLEAN NOT NULL DEFAULT false,
    "opted_out_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."customers" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "business_id" UUID NOT NULL,
    "display_name" TEXT,
    "first_contact_channel" TEXT,
    "first_contact_at" TIMESTAMPTZ(6),
    "consent_status" "public"."consent_status" NOT NULL DEFAULT 'implied_inbound',
    "opted_out_at" TIMESTAMPTZ(6),
    "do_not_contact" BOOLEAN NOT NULL DEFAULT false,
    "ai_disclosure_sent_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."escalations" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "business_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "customer_id" UUID,
    "category" "public"."escalation_category" NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "urgency" TEXT NOT NULL DEFAULT 'standard',
    "ai_summary" TEXT,
    "resolution_note" TEXT,
    "resolved_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),

    CONSTRAINT "escalations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."event_log" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "business_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "event_code" TEXT NOT NULL,
    "event_family" "public"."event_family" NOT NULL,
    "source_actor" "public"."source_actor" NOT NULL,
    "related_record_type" TEXT,
    "related_record_id" UUID,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."message_log" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "business_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "direction" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "sender_type" TEXT NOT NULL,
    "sender_user_id" UUID,
    "content" TEXT,
    "subject_line" TEXT,
    "media_urls" JSONB,
    "twilio_message_sid" TEXT,
    "is_voice_transcript" BOOLEAN NOT NULL DEFAULT false,
    "voice_recording_url" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."message_templates" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "business_id" UUID NOT NULL,
    "message_type" TEXT NOT NULL,
    "custom_template" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."notifications" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "business_id" UUID NOT NULL,
    "user_id" UUID,
    "notification_type" "public"."notification_type" NOT NULL,
    "reference_type" TEXT,
    "reference_id" UUID,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "dismissed_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6) DEFAULT (now() + '30 days'::interval),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."outbound_queue" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "business_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "message_purpose" TEXT NOT NULL,
    "audience_type" "public"."audience_type" NOT NULL,
    "channel" "public"."message_channel" NOT NULL,
    "template_code" TEXT,
    "content" TEXT,
    "dedupe_key" TEXT NOT NULL,
    "workflow_key" TEXT,
    "state_snapshot" TEXT,
    "status" "public"."outbound_status" NOT NULL DEFAULT 'pending',
    "scheduled_send_at" TIMESTAMPTZ(6) NOT NULL,
    "quiet_hours_deferred_until" TIMESTAMPTZ(6),
    "claim_token" UUID,
    "claimed_at" TIMESTAMPTZ(6),
    "claim_expires_at" TIMESTAMPTZ(6),
    "send_attempt_count" INTEGER NOT NULL DEFAULT 0,
    "max_retry_count" INTEGER NOT NULL DEFAULT 3,
    "last_attempt_at" TIMESTAMPTZ(6),
    "next_retry_at" TIMESTAMPTZ(6),
    "invalidated_by_event_id" UUID,
    "send_result_code" TEXT,
    "terminal_failure_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbound_queue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."parts_inquiries" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "business_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "appointment_id" UUID,
    "part_description" TEXT NOT NULL,
    "model_number" TEXT,
    "urgency" TEXT NOT NULL DEFAULT 'standard',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "confirmed_price" DECIMAL,
    "confirmed_eta" TEXT,
    "confirmed_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMPTZ(6),

    CONSTRAINT "parts_inquiries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."payment_management" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "business_id" UUID NOT NULL,
    "appointment_id" UUID,
    "conversation_id" UUID,
    "customer_id" UUID NOT NULL,
    "job_description" TEXT,
    "amount_due" DECIMAL,
    "payment_status" TEXT NOT NULL DEFAULT 'pending',
    "job_date" DATE,
    "completion_date" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_management_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."post_job_closeouts" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "business_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "completion_record_type" TEXT NOT NULL,
    "completion_record_id" UUID NOT NULL,
    "eligibility_status" TEXT NOT NULL,
    "blocked_reason" TEXT,
    "queued_queue_id" UUID,
    "sent_message_log_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_job_closeouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."pricing_items" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "business_id" UUID NOT NULL,
    "service_name" TEXT NOT NULL,
    "price_type" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "description" TEXT,
    "is_shareable_by_ai" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pricing_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."prompt_log" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "business_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "message_id" UUID,
    "prompt_purpose" TEXT NOT NULL,
    "prompt_text" TEXT NOT NULL,
    "response_text" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "token_count_prompt" INTEGER,
    "token_count_response" INTEGER,
    "latency_ms" INTEGER,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL DEFAULT (now() + '30 days'::interval),

    CONSTRAINT "prompt_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."quotes" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "business_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "status" "public"."quote_status" NOT NULL DEFAULT 'intake_open',
    "requested_service" TEXT,
    "quote_details" TEXT,
    "approved_amount" DECIMAL,
    "approved_terms" TEXT,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "sent_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "customer_response" TEXT,
    "customer_responded_at" TIMESTAMPTZ(6),
    "superseded_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."recurring_service_change_requests" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "business_id" UUID NOT NULL,
    "recurring_service_id" UUID NOT NULL,
    "conversation_id" UUID,
    "request_type" "public"."recurring_change_request_type" NOT NULL,
    "request_status" "public"."recurring_change_request_status" NOT NULL DEFAULT 'draft',
    "customer_reason" TEXT,
    "preferred_day_text" TEXT,
    "preferred_window_text" TEXT,
    "flexibility_notes" TEXT,
    "new_frequency" TEXT,
    "suppression_active" BOOLEAN NOT NULL DEFAULT false,
    "suppression_started_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recurring_service_change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."recurring_services" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "business_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "service_type" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "frequency_details" TEXT,
    "preferred_day" TEXT,
    "preferred_time" TIME(6),
    "address" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "created_by" TEXT NOT NULL,
    "admin_notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recurring_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."twilio_config" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "business_id" UUID NOT NULL,
    "twilio_phone_number" TEXT NOT NULL,
    "twilio_account_sid" TEXT NOT NULL,
    "twilio_auth_token" TEXT NOT NULL,
    "twilio_messaging_service_sid" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "twilio_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."users" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "business_id" UUID,
    "email" TEXT NOT NULL,
    "display_name" TEXT,
    "role" "public"."user_role" NOT NULL,
    "password_hash" TEXT,
    "notification_preferences" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."web_chat_sessions" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "business_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "session_token" UUID NOT NULL,
    "customer_ip" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL DEFAULT (now() + '24:00:00'::interval),

    CONSTRAINT "web_chat_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "appointments_calendar_idx" ON "public"."appointments"("business_id" ASC, "appointment_date" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "appointments_list_idx" ON "public"."appointments"("business_id" ASC, "status" ASC, "appointment_date" ASC, "appointment_time" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "business_config_business_id_key" ON "public"."business_config"("business_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "businesses_owner_user_id_unique" ON "public"."businesses"("owner_user_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "businesses_slug_key" ON "public"."businesses"("slug" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "calendar_connections_business_id_key" ON "public"."calendar_connections"("business_id" ASC);

-- CreateIndex
CREATE INDEX "calendar_sync_log_appointment_idx" ON "public"."calendar_sync_log"("appointment_id" ASC, "created_at" DESC);

-- CreateIndex
CREATE INDEX "calendar_sync_log_business_idx" ON "public"."calendar_sync_log"("business_id" ASC, "created_at" DESC);

-- CreateIndex
CREATE INDEX "conversations_dashboard_idx" ON "public"."conversations"("business_id" ASC, "primary_state" ASC, "current_owner" ASC, "last_state_change_at" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "customer_contacts_unique" ON "public"."customer_contacts"("business_id" ASC, "contact_type" ASC, "contact_value" ASC);

-- CreateIndex
CREATE INDEX "event_log_lookup_idx" ON "public"."event_log"("business_id" ASC, "conversation_id" ASC, "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "outbound_queue_dedupe_unique" ON "public"."outbound_queue"("business_id" ASC, "dedupe_key" ASC);

-- CreateIndex
CREATE INDEX "prompt_log_lookup_idx" ON "public"."prompt_log"("business_id" ASC, "conversation_id" ASC, "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_twilio_config_phone" ON "public"."twilio_config"("twilio_phone_number" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "twilio_config_business_id_key" ON "public"."twilio_config"("business_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "twilio_config_twilio_phone_number_key" ON "public"."twilio_config"("twilio_phone_number" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "public"."users"("email" ASC);

-- CreateIndex
CREATE INDEX "web_chat_sessions_lookup_idx" ON "public"."web_chat_sessions"("business_id" ASC, "session_token" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "web_chat_sessions_session_token_key" ON "public"."web_chat_sessions"("session_token" ASC);

-- AddForeignKey
ALTER TABLE "public"."appointment_change_requests" ADD CONSTRAINT "appointment_change_requests_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."appointment_change_requests" ADD CONSTRAINT "appointment_change_requests_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."appointment_change_requests" ADD CONSTRAINT "appointment_change_requests_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."appointments" ADD CONSTRAINT "appointments_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."appointments" ADD CONSTRAINT "appointments_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."appointments" ADD CONSTRAINT "appointments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."appointments" ADD CONSTRAINT "appointments_recurring_service_fkey" FOREIGN KEY ("recurring_service_id") REFERENCES "public"."recurring_services"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."approval_requests" ADD CONSTRAINT "approval_requests_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."approval_requests" ADD CONSTRAINT "approval_requests_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."approval_requests" ADD CONSTRAINT "approval_requests_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."approval_requests" ADD CONSTRAINT "approval_requests_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."attachments" ADD CONSTRAINT "attachments_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."attachments" ADD CONSTRAINT "attachments_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."attachments" ADD CONSTRAINT "attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "public"."message_log"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."business_config" ADD CONSTRAINT "business_config_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."businesses" ADD CONSTRAINT "businesses_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."calendar_connections" ADD CONSTRAINT "calendar_connections_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."calendar_sync_log" ADD CONSTRAINT "calendar_sync_log_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."calendar_sync_log" ADD CONSTRAINT "calendar_sync_log_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."conversation_merges" ADD CONSTRAINT "conversation_merges_absorbed_conversation_id_fkey" FOREIGN KEY ("absorbed_conversation_id") REFERENCES "public"."conversations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."conversation_merges" ADD CONSTRAINT "conversation_merges_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."conversation_merges" ADD CONSTRAINT "conversation_merges_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."conversation_merges" ADD CONSTRAINT "conversation_merges_surviving_conversation_id_fkey" FOREIGN KEY ("surviving_conversation_id") REFERENCES "public"."conversations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."conversation_tags" ADD CONSTRAINT "conversation_tags_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."conversation_tags" ADD CONSTRAINT "conversation_tags_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."conversations" ADD CONSTRAINT "conversations_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."conversations" ADD CONSTRAINT "conversations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."conversations" ADD CONSTRAINT "conversations_last_customer_message_fkey" FOREIGN KEY ("last_customer_message_id") REFERENCES "public"."message_log"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."conversations" ADD CONSTRAINT "conversations_last_outbound_message_fkey" FOREIGN KEY ("last_outbound_message_id") REFERENCES "public"."message_log"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."customer_contacts" ADD CONSTRAINT "customer_contacts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."customer_contacts" ADD CONSTRAINT "customer_contacts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."customers" ADD CONSTRAINT "customers_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."escalations" ADD CONSTRAINT "escalations_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."escalations" ADD CONSTRAINT "escalations_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."escalations" ADD CONSTRAINT "escalations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."escalations" ADD CONSTRAINT "escalations_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."event_log" ADD CONSTRAINT "event_log_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."event_log" ADD CONSTRAINT "event_log_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."message_log" ADD CONSTRAINT "message_log_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."message_log" ADD CONSTRAINT "message_log_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."message_log" ADD CONSTRAINT "message_log_sender_user_id_fkey" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."message_templates" ADD CONSTRAINT "message_templates_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."outbound_queue" ADD CONSTRAINT "outbound_queue_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."outbound_queue" ADD CONSTRAINT "outbound_queue_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."outbound_queue" ADD CONSTRAINT "outbound_queue_invalidated_by_event_id_fkey" FOREIGN KEY ("invalidated_by_event_id") REFERENCES "public"."event_log"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."parts_inquiries" ADD CONSTRAINT "parts_inquiries_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."parts_inquiries" ADD CONSTRAINT "parts_inquiries_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."parts_inquiries" ADD CONSTRAINT "parts_inquiries_confirmed_by_fkey" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."parts_inquiries" ADD CONSTRAINT "parts_inquiries_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."payment_management" ADD CONSTRAINT "payment_management_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."payment_management" ADD CONSTRAINT "payment_management_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."payment_management" ADD CONSTRAINT "payment_management_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."payment_management" ADD CONSTRAINT "payment_management_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."post_job_closeouts" ADD CONSTRAINT "post_job_closeouts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."post_job_closeouts" ADD CONSTRAINT "post_job_closeouts_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."post_job_closeouts" ADD CONSTRAINT "post_job_closeouts_queued_queue_id_fkey" FOREIGN KEY ("queued_queue_id") REFERENCES "public"."outbound_queue"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."post_job_closeouts" ADD CONSTRAINT "post_job_closeouts_sent_message_log_id_fkey" FOREIGN KEY ("sent_message_log_id") REFERENCES "public"."message_log"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."pricing_items" ADD CONSTRAINT "pricing_items_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."prompt_log" ADD CONSTRAINT "prompt_log_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."prompt_log" ADD CONSTRAINT "prompt_log_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."prompt_log" ADD CONSTRAINT "prompt_log_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "public"."message_log"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."quotes" ADD CONSTRAINT "quotes_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."quotes" ADD CONSTRAINT "quotes_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."quotes" ADD CONSTRAINT "quotes_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."quotes" ADD CONSTRAINT "quotes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."quotes" ADD CONSTRAINT "quotes_superseded_by_fkey" FOREIGN KEY ("superseded_by") REFERENCES "public"."quotes"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."recurring_service_change_requests" ADD CONSTRAINT "recurring_service_change_requests_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."recurring_service_change_requests" ADD CONSTRAINT "recurring_service_change_requests_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."recurring_service_change_requests" ADD CONSTRAINT "recurring_service_change_requests_recurring_service_id_fkey" FOREIGN KEY ("recurring_service_id") REFERENCES "public"."recurring_services"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."recurring_services" ADD CONSTRAINT "recurring_services_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."recurring_services" ADD CONSTRAINT "recurring_services_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."twilio_config" ADD CONSTRAINT "twilio_config_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."users" ADD CONSTRAINT "users_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."web_chat_sessions" ADD CONSTRAINT "web_chat_sessions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."web_chat_sessions" ADD CONSTRAINT "web_chat_sessions_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

