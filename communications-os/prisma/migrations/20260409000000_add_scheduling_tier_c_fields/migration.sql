-- CreateEnum
CREATE TYPE "SchedulingMode" AS ENUM ('active', 'paused', 'resync_pending');

-- AlterTable: scheduling_jobs — add Tier C fields
ALTER TABLE "scheduling_jobs"
  ADD COLUMN "manual_position_set_date" TIMESTAMPTZ(6),
  ADD COLUMN "queue_version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "rebook_count" INTEGER NOT NULL DEFAULT 0;

-- AlterTable: businesses — add scheduling_mode column
ALTER TABLE "businesses"
  ADD COLUMN "scheduling_mode" "SchedulingMode" NOT NULL DEFAULT 'active';
