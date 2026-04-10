-- CreateEnum: TransferApproval
CREATE TYPE "TransferApproval" AS ENUM ('auto_same_day', 'owner_required', 'emergency_bypass');

-- CreateEnum: PullForwardOfferStatus
CREATE TYPE "PullForwardOfferStatus" AS ENUM ('active', 'accepted', 'expired', 'declined');

-- AlterTable: add transfer_count to scheduling_jobs
ALTER TABLE "scheduling_jobs"
  ADD COLUMN "transfer_count" INTEGER NOT NULL DEFAULT 0;

-- CreateTable: pull_forward_offers
CREATE TABLE "pull_forward_offers" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "gap_id" TEXT NOT NULL,
    "scheduling_job_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "customer_phone" TEXT NOT NULL,
    "original_technician_id" UUID NOT NULL,
    "original_date" DATE NOT NULL,
    "original_queue_position" INTEGER NOT NULL,
    "target_technician_id" UUID NOT NULL,
    "target_date" DATE NOT NULL,
    "new_queue_position" INTEGER NOT NULL,
    "total_cost_minutes" INTEGER NOT NULL,
    "time_preference" "TimePreference" NOT NULL,
    "original_window" TEXT NOT NULL,
    "new_window" TEXT NOT NULL,
    "status" "PullForwardOfferStatus" NOT NULL DEFAULT 'active',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pull_forward_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable: transfer_events
CREATE TABLE "transfer_events" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "scheduling_job_id" UUID NOT NULL,
    "from_technician_id" UUID NOT NULL,
    "to_technician_id" UUID NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    "from_queue_position" INTEGER NOT NULL,
    "to_queue_position" INTEGER NOT NULL,
    "approval_type" "TransferApproval" NOT NULL,
    "net_drive_time_saving_minutes" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transfer_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pull_forward_offers_job_idx" ON "pull_forward_offers"("scheduling_job_id", "status");
CREATE INDEX "pull_forward_offers_gap_idx" ON "pull_forward_offers"("gap_id", "status");
CREATE INDEX "transfer_events_job_idx" ON "transfer_events"("scheduling_job_id");
CREATE INDEX "transfer_events_from_tech_idx" ON "transfer_events"("from_technician_id", "created_at");

-- AddForeignKey
ALTER TABLE "pull_forward_offers" ADD CONSTRAINT "pull_forward_offers_scheduling_job_id_fkey" FOREIGN KEY ("scheduling_job_id") REFERENCES "scheduling_jobs"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "transfer_events" ADD CONSTRAINT "transfer_events_scheduling_job_id_fkey" FOREIGN KEY ("scheduling_job_id") REFERENCES "scheduling_jobs"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
