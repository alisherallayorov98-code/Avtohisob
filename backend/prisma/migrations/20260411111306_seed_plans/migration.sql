INSERT INTO "plans" (id, name, type, "priceMonthly", "priceYearly", "maxVehicles", "maxBranches", "maxUsers", features, "isActive", "createdAt")
VALUES
  (gen_random_uuid(), 'Bepul',        'free',         0,      0,      5,   1,  3,  '[]', true, NOW()),
  (gen_random_uuid(), 'Starter',      'starter',      199000, 1990000, 20,  2,  10, '[]', true, NOW()),
  (gen_random_uuid(), 'Professional', 'professional', 499000, 4990000, 100, 5,  30, '[]', true, NOW()),
  (gen_random_uuid(), 'Enterprise',   'enterprise',   999000, 9990000, 999, 99, 99, '[]', true, NOW())
ON CONFLICT (type) DO NOTHING;
