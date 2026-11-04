-- Optional LiDAR depth track path on Clip (ADR-020).
-- Nullable with no default: every existing row means "no depth was captured",
-- which is the truth for every clip taken before the depth writer shipped.
ALTER TABLE "Clip" ADD COLUMN "depthPath" TEXT;
