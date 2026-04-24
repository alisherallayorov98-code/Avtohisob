-- Add 'pending' value to SubscriptionStatus enum
-- This enables subscriptions to be created in pending state while awaiting payment approval

ALTER TYPE "SubscriptionStatus" ADD VALUE IF NOT EXISTS 'pending';
