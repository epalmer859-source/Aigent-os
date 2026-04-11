-- Add technician role to user_role enum
ALTER TYPE "user_role" ADD VALUE IF NOT EXISTS 'technician';

-- Add technician_id column to users table
ALTER TABLE "users" ADD COLUMN "technician_id" UUID;

-- Add foreign key constraint
ALTER TABLE "users" ADD CONSTRAINT "users_technician_id_fkey"
  FOREIGN KEY ("technician_id") REFERENCES "technicians"("id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;
