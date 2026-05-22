-- Migration: prompt_versions table + QQP pipeline columns
-- Date: 2026-05-21
-- Part of: Finishing Coefficient (F) Pipeline Redesign

-- 1. prompt_versions table
CREATE TABLE IF NOT EXISTS prompt_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_type TEXT NOT NULL CHECK (prompt_type IN ('sqm_extraction', 'qqp_extraction')),
  version_number INTEGER NOT NULL,
  system_prompt TEXT NOT NULL,
  user_template TEXT NOT NULL,
  is_active BOOLEAN DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(prompt_type, version_number)
);

CREATE INDEX IF NOT EXISTS idx_prompt_versions_active
  ON prompt_versions(prompt_type) WHERE is_active = true;

-- 2. Add columns to dossier_qqp_values
ALTER TABLE dossier_qqp_values
  ADD COLUMN IF NOT EXISTS prompt_version_id UUID REFERENCES prompt_versions(id),
  ADD COLUMN IF NOT EXISTS extraction_method TEXT DEFAULT 'ai_extracted'
    CHECK (extraction_method IN ('ai_extracted', 'programmatic_conversion'));

-- 3. Add columns to qqp_model_versions
ALTER TABLE qqp_model_versions
  ADD COLUMN IF NOT EXISTS intercept DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS lambda DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS prompt_version_id UUID REFERENCES prompt_versions(id),
  ADD COLUMN IF NOT EXISTS training_config JSONB;

-- 4. RLS for prompt_versions (read for authenticated, write for service role)
ALTER TABLE prompt_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated users to read prompt_versions"
  ON prompt_versions FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow service role full access to prompt_versions"
  ON prompt_versions FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
