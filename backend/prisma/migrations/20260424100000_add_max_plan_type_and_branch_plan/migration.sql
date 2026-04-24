-- User.maxPlanType: super admin sets the ceiling for each admin
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "maxPlanType" "PlanType" NOT NULL DEFAULT 'free';

-- Branch.planId: admin can assign a plan to each branch
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "planId" TEXT;
ALTER TABLE "branches" ADD CONSTRAINT "branches_planId_fkey"
  FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
