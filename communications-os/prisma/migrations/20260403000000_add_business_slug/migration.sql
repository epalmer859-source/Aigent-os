-- AlterTable: add slug column to businesses
ALTER TABLE "businesses" ADD COLUMN "slug" TEXT;

-- CreateIndex: unique constraint on slug
CREATE UNIQUE INDEX "businesses_slug_key" ON "businesses"("slug");
