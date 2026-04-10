-- CreateEnum
CREATE TYPE "SchedulingJobStatus" AS ENUM ('NOT_STARTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED', 'INCOMPLETE', 'CANCELED', 'NEEDS_REBOOK', 'BEYOND_SAME_DAY');

-- CreateEnum
CREATE TYPE "VolatilityTier" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "TimePreference" AS ENUM ('MORNING', 'AFTERNOON', 'SOONEST', 'NO_PREFERENCE');

-- CreateEnum
CREATE TYPE "CompletionNote" AS ENUM ('FIXED', 'NEEDS_FOLLOWUP', 'CUSTOMER_DECLINED');

-- CreateEnum
CREATE TYPE "SchedulingTriggeredBy" AS ENUM ('AI', 'OWNER', 'TECH', 'SYSTEM');

-- DropForeignKey
ALTER TABLE "appointment_change_requests" DROP CONSTRAINT "appointment_change_requests_appointment_id_fkey";

-- DropForeignKey
ALTER TABLE "appointment_change_requests" DROP CONSTRAINT "appointment_change_requests_business_id_fkey";

-- DropForeignKey
ALTER TABLE "appointment_change_requests" DROP CONSTRAINT "appointment_change_requests_conversation_id_fkey";

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "scheduling_job_id" UUID;

-- DropTable
DROP TABLE "appointment_change_requests";

-- DropEnum
DROP TYPE "appointment_request_status";

-- CreateTable
CREATE TABLE "technicians" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "home_base_lat" DOUBLE PRECISION NOT NULL,
    "home_base_lng" DOUBLE PRECISION NOT NULL,
    "home_base_address" TEXT NOT NULL,
    "working_hours_start" TEXT NOT NULL DEFAULT '08:00',
    "working_hours_end" TEXT NOT NULL DEFAULT '17:00',
    "lunch_start" TEXT NOT NULL DEFAULT '12:00',
    "lunch_end" TEXT NOT NULL DEFAULT '12:30',
    "overtime_cap_minutes" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "location_services_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "technicians_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "technician_skill_tags" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "technician_id" UUID NOT NULL,
    "service_type_id" UUID NOT NULL,

    CONSTRAINT "technician_skill_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_types" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "industry" TEXT NOT NULL,
    "base_duration_minutes" INTEGER NOT NULL,
    "volatility_tier" "VolatilityTier" NOT NULL,
    "buffer_multiplier" DOUBLE PRECISION NOT NULL,
    "property_type_variants" JSONB,
    "symptom_phrases" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduling_jobs" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "business_id" UUID NOT NULL,
    "technician_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "appointment_id" UUID,
    "service_type_id" UUID NOT NULL,
    "status" "SchedulingJobStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "queue_position" INTEGER NOT NULL,
    "scheduled_date" DATE NOT NULL,
    "time_preference" "TimePreference" NOT NULL DEFAULT 'NO_PREFERENCE',
    "estimated_duration_minutes" INTEGER NOT NULL,
    "actual_duration_minutes" INTEGER,
    "drive_time_minutes" INTEGER NOT NULL,
    "address_lat" DOUBLE PRECISION NOT NULL,
    "address_lng" DOUBLE PRECISION NOT NULL,
    "address_text" TEXT NOT NULL,
    "job_notes" TEXT,
    "manual_position" BOOLEAN NOT NULL DEFAULT false,
    "ai_classified_type" TEXT,
    "tech_confirmed_type" TEXT,
    "completion_note" "CompletionNote",
    "arrived_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scheduling_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capacity_reservations" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "business_id" UUID NOT NULL,
    "technician_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "total_available_minutes" INTEGER NOT NULL,
    "reserved_minutes" INTEGER NOT NULL DEFAULT 0,
    "morning_reserved_minutes" INTEGER NOT NULL DEFAULT 0,
    "afternoon_reserved_minutes" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "capacity_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduling_events" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "scheduling_job_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "old_value" TEXT,
    "new_value" TEXT,
    "triggered_by" "SchedulingTriggeredBy" NOT NULL,
    "timestamp" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scheduling_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rebook_queue" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "business_id" UUID NOT NULL,
    "scheduling_job_id" UUID NOT NULL,
    "original_date" DATE NOT NULL,
    "original_technician_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "customer_notified" BOOLEAN NOT NULL DEFAULT false,
    "owner_notified" BOOLEAN NOT NULL DEFAULT false,
    "resolved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rebook_queue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_arrangements" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "business_id" UUID NOT NULL,
    "technician_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "manually_arranged_at" TIMESTAMPTZ(6) NOT NULL,
    "reset_at" TIMESTAMPTZ(6),

    CONSTRAINT "queue_arrangements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "technicians_business_active_idx" ON "technicians"("business_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "technician_skill_tags_unique" ON "technician_skill_tags"("technician_id", "service_type_id");

-- CreateIndex
CREATE INDEX "service_types_business_idx" ON "service_types"("business_id");

-- CreateIndex
CREATE INDEX "scheduling_jobs_date_status_idx" ON "scheduling_jobs"("business_id", "scheduled_date", "status");

-- CreateIndex
CREATE INDEX "scheduling_jobs_tech_date_idx" ON "scheduling_jobs"("technician_id", "scheduled_date", "status");

-- CreateIndex
CREATE INDEX "scheduling_jobs_tech_active_idx" ON "scheduling_jobs"("technician_id", "status");

-- CreateIndex
CREATE INDEX "scheduling_jobs_customer_idx" ON "scheduling_jobs"("customer_id");

-- CreateIndex
CREATE INDEX "capacity_reservations_business_date_idx" ON "capacity_reservations"("business_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "capacity_reservations_tech_date_unique" ON "capacity_reservations"("technician_id", "date");

-- CreateIndex
CREATE INDEX "scheduling_events_job_idx" ON "scheduling_events"("scheduling_job_id", "timestamp");

-- CreateIndex
CREATE INDEX "rebook_queue_unresolved_idx" ON "rebook_queue"("business_id", "resolved_at");

-- CreateIndex
CREATE UNIQUE INDEX "queue_arrangements_tech_date_unique" ON "queue_arrangements"("technician_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_scheduling_job_id_key" ON "appointments"("scheduling_job_id");

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_scheduling_job_id_fkey" FOREIGN KEY ("scheduling_job_id") REFERENCES "scheduling_jobs"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "technicians" ADD CONSTRAINT "technicians_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "technician_skill_tags" ADD CONSTRAINT "technician_skill_tags_technician_id_fkey" FOREIGN KEY ("technician_id") REFERENCES "technicians"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "technician_skill_tags" ADD CONSTRAINT "technician_skill_tags_service_type_id_fkey" FOREIGN KEY ("service_type_id") REFERENCES "service_types"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "service_types" ADD CONSTRAINT "service_types_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "scheduling_jobs" ADD CONSTRAINT "scheduling_jobs_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "scheduling_jobs" ADD CONSTRAINT "scheduling_jobs_technician_id_fkey" FOREIGN KEY ("technician_id") REFERENCES "technicians"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "scheduling_jobs" ADD CONSTRAINT "scheduling_jobs_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "scheduling_jobs" ADD CONSTRAINT "scheduling_jobs_service_type_id_fkey" FOREIGN KEY ("service_type_id") REFERENCES "service_types"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "capacity_reservations" ADD CONSTRAINT "capacity_reservations_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "capacity_reservations" ADD CONSTRAINT "capacity_reservations_technician_id_fkey" FOREIGN KEY ("technician_id") REFERENCES "technicians"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "scheduling_events" ADD CONSTRAINT "scheduling_events_scheduling_job_id_fkey" FOREIGN KEY ("scheduling_job_id") REFERENCES "scheduling_jobs"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "rebook_queue" ADD CONSTRAINT "rebook_queue_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "rebook_queue" ADD CONSTRAINT "rebook_queue_scheduling_job_id_fkey" FOREIGN KEY ("scheduling_job_id") REFERENCES "scheduling_jobs"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "queue_arrangements" ADD CONSTRAINT "queue_arrangements_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "queue_arrangements" ADD CONSTRAINT "queue_arrangements_technician_id_fkey" FOREIGN KEY ("technician_id") REFERENCES "technicians"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

