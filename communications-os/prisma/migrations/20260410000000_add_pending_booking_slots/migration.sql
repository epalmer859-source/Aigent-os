-- Add pending_booking_slots JSONB column to conversations
-- Stores generated slot options during the two-step booking flow
ALTER TABLE "conversations" ADD COLUMN "pending_booking_slots" JSONB;
