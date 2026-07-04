-- Allow camera-scanned card photos to be tracked separately from manual photos
-- while still counting as real item photos for listing readiness.
ALTER TYPE "PhotoOrigin" ADD VALUE IF NOT EXISTS 'SCAN';
