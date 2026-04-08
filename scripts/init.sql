-- AutoHisob database initialization
-- This file runs once when the PostgreSQL container first starts

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- For fuzzy text search

-- Set default timezone
ALTER DATABASE avtohisob SET timezone TO 'Asia/Tashkent';

-- Log initial setup
DO $$
BEGIN
  RAISE NOTICE 'AutoHisob database initialized at %', NOW();
END $$;
