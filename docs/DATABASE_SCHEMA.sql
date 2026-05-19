-- BuildCost MVP — Supabase Migration
-- Run this as the initial migration in your Supabase project

-- ============================================================
-- MULTI-TENANT
-- ============================================================

CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES tenants(id),
  email TEXT NOT NULL,
  full_name TEXT,
  role TEXT DEFAULT 'user' CHECK (role IN ('admin', 'user', 'viewer')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- REFERENCE DATA
-- ============================================================

CREATE TABLE postcode_prices (
  postcode TEXT PRIMARY KEY,
  municipality TEXT,
  province TEXT,
  region TEXT, -- 'flanders', 'wallonia', 'brussels'
  base_price_per_sqm DECIMAL NOT NULL,
  year INTEGER NOT NULL,
  source TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE abex_index (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year INTEGER NOT NULL,
  semester INTEGER NOT NULL CHECK (semester IN (1, 2)),
  index_value DECIMAL NOT NULL,
  base_year INTEGER DEFAULT 2020,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(year, semester)
);

-- ============================================================
-- SYSTEM SETTINGS
-- ============================================================

CREATE TABLE system_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,           -- stored as JSONB; use #>> '{}' to read as text
  display_name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL,
  updated_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Helper: read a setting as text with an optional default
CREATE OR REPLACE FUNCTION get_setting(p_key TEXT, p_default TEXT DEFAULT NULL)
RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT value #>> '{}' FROM system_settings WHERE key = p_key),
    p_default
  );
$$;

-- ============================================================
-- QQP ENGINE
-- ============================================================

CREATE TABLE qqp_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE, -- 'size_layout', 'room_count', 'equipment', 'proportionality'
  display_name TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE qqp_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID REFERENCES qqp_categories(id),
  name TEXT NOT NULL UNIQUE, -- 'entrance_hall_sqm', 'bathroom_count', etc.
  display_name TEXT NOT NULL,
  description TEXT,
  data_type TEXT NOT NULL CHECK (data_type IN ('numeric', 'boolean', 'categorical', 'score')),
  unit TEXT, -- 'm2', 'count', 'ratio', 'score', null for boolean
  weight DECIMAL DEFAULT 0,
  weight_confidence DECIMAL DEFAULT 0, -- how confident we are in the weight
  expected_correlation TEXT, -- 'positive', 'negative', 'neutral'
  discovery_source TEXT DEFAULT 'seeded' CHECK (discovery_source IN ('seeded', 'expert_added', 'ai_discovered')),
  discovery_count INTEGER DEFAULT 0, -- times AI has proposed this (for ai_discovered)
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- REFERENCE DOSSIERS (Training Data)
-- ============================================================

CREATE TABLE reference_dossiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),

  -- Known info from the dossier
  address TEXT,
  postcode TEXT,
  municipality TEXT,
  building_type TEXT, -- 'house', 'apartment', 'villa', etc.
  known_price_per_sqm DECIMAL,
  known_total_price DECIMAL,
  known_total_sqm DECIMAL,
  known_finishing_coefficient DECIMAL,
  expert_notes TEXT, -- original expert description
  expert_finishing_level TEXT, -- 'basic', 'standard', 'comfort', 'luxury', 'premium'

  -- ABEX period when the expert price was set
  price_abex_year INTEGER,
  price_abex_semester INTEGER CHECK (price_abex_semester IN (1, 2)),

  -- File storage
  plan_storage_path TEXT, -- Supabase Storage path
  plan_file_name TEXT,
  plan_file_type TEXT, -- 'pdf', 'image', 'cad'

  -- AI extraction results
  sqm_extraction JSONB, -- full WS1 output (SQM_CONTRACT format)
  qqp_extraction JSONB, -- extracted QQP values

  -- Predicted vs actual
  predicted_finishing_coefficient DECIMAL,
  prediction_error DECIMAL, -- predicted - actual

  -- Status
  status TEXT DEFAULT 'pending' CHECK (status IN (
    'pending',        -- uploaded, not yet processed
    'extracting_sqm', -- WS1 processing
    'sqm_done',       -- SQM extracted, awaiting QQP
    'extracting_qqp', -- WS2 processing
    'analyzed',       -- fully processed
    'validated',      -- human-verified
    'error'           -- processing failed
  )),
  error_message TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Individual QQP values extracted from each dossier
CREATE TABLE dossier_qqp_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id UUID REFERENCES reference_dossiers(id) ON DELETE CASCADE,
  qqp_id UUID REFERENCES qqp_definitions(id),
  value_numeric DECIMAL,
  value_boolean BOOLEAN,
  value_text TEXT,
  confidence DECIMAL DEFAULT 0.5,
  extraction_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(dossier_id, qqp_id)
);

-- ============================================================
-- QQP MODEL VERSIONING  (must come before estimations)
-- ============================================================

CREATE TABLE qqp_model_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version INTEGER NOT NULL,
  weights JSONB NOT NULL, -- {qqp_name: weight, ...}
  training_dossier_count INTEGER,
  accuracy_metrics JSONB, -- {mae, rmse, r_squared, ...}
  notes TEXT,
  is_active BOOLEAN DEFAULT false, -- only one active at a time
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- ESTIMATIONS (Production Usage)
-- ============================================================

CREATE TABLE estimations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  created_by UUID REFERENCES users(id),

  -- Input
  plan_storage_path TEXT,
  plan_file_name TEXT,
  postcode TEXT,
  postcode_provided_by TEXT DEFAULT 'user' CHECK (postcode_provided_by IN ('user', 'plan', 'auto')),

  -- Extracted data
  building_type TEXT,
  sqm_extraction JSONB, -- full WS1 output
  total_livable_sqm DECIMAL,
  total_gross_sqm DECIMAL,
  sub_areas JSONB, -- simplified: {living: 35.2, kitchen: 18.0, ...}

  -- QQP analysis
  extracted_qqps JSONB, -- {qqp_name: value, ...}
  finishing_level TEXT, -- 'basic', 'standard', 'comfort', 'luxury', 'premium'
  finishing_coefficient DECIMAL,

  -- Cost calculation
  base_price_per_sqm DECIMAL, -- from postcode lookup
  abex_factor DECIMAL, -- current ABEX index ratio
  estimated_price_per_sqm DECIMAL, -- final price/m²
  estimated_total_cost DECIMAL, -- final total

  -- Confidence
  sqm_confidence DECIMAL,
  qqp_confidence DECIMAL,
  overall_confidence DECIMAL,

  -- Status
  status TEXT DEFAULT 'uploading' CHECK (status IN (
    'uploading',
    'extracting_sqm',
    'analyzing_qqp',
    'calculating',
    'complete',
    'error'
  )),
  error_message TEXT,

  -- Metadata
  processing_time_ms INTEGER,
  model_version_id UUID REFERENCES qqp_model_versions(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- QQP DISCOVERY LOG
-- ============================================================

CREATE TABLE qqp_discovery_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id UUID REFERENCES reference_dossiers(id),
  proposed_name TEXT NOT NULL,
  proposed_description TEXT,
  proposed_data_type TEXT,
  reasoning TEXT, -- why the AI thinks this matters
  prediction_residual DECIMAL, -- how far off was the prediction
  status TEXT DEFAULT 'proposed' CHECK (status IN ('proposed', 'accepted', 'rejected')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX idx_reference_dossiers_status ON reference_dossiers(status);
CREATE INDEX idx_reference_dossiers_postcode ON reference_dossiers(postcode);
CREATE INDEX idx_reference_dossiers_tenant ON reference_dossiers(tenant_id);
CREATE INDEX idx_estimations_tenant ON estimations(tenant_id);
CREATE INDEX idx_estimations_status ON estimations(status);
CREATE INDEX idx_estimations_created ON estimations(created_at DESC);
CREATE INDEX idx_dossier_qqp_values_dossier ON dossier_qqp_values(dossier_id);
CREATE INDEX idx_dossier_qqp_values_qqp ON dossier_qqp_values(qqp_id);
CREATE INDEX idx_qqp_definitions_active ON qqp_definitions(is_active) WHERE is_active = true;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE reference_dossiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimations ENABLE ROW LEVEL SECURITY;

-- Users can see their own tenant
CREATE POLICY "Users see own tenant" ON tenants
  FOR SELECT USING (
    id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
  );

-- Users see own profile
CREATE POLICY "Users see own profile" ON users
  FOR SELECT USING (id = auth.uid());

-- Users see own tenant's dossiers
CREATE POLICY "Users see own tenant dossiers" ON reference_dossiers
  FOR ALL USING (
    tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
  );

-- Users see own tenant's estimations
CREATE POLICY "Users see own tenant estimations" ON estimations
  FOR ALL USING (
    tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
  );

-- QQP definitions and reference data are public read
-- (no RLS needed — they're shared across tenants)

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

-- Returns the base price/m² for a postcode; falls back to the regional
-- average, then to the national default stored in system_settings.
CREATE OR REPLACE FUNCTION get_regional_coefficient(p_postcode TEXT)
RETURNS DECIMAL LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_price DECIMAL;
  v_region TEXT;
  v_default DECIMAL;
BEGIN
  -- Exact postcode match
  SELECT base_price_per_sqm INTO v_price
  FROM postcode_prices
  WHERE postcode = p_postcode
  LIMIT 1;

  IF v_price IS NOT NULL THEN
    RETURN v_price;
  END IF;

  -- Regional average (first 2 digits of postcode = province prefix)
  SELECT AVG(base_price_per_sqm) INTO v_price
  FROM postcode_prices
  WHERE LEFT(postcode, 2) = LEFT(p_postcode, 2);

  IF v_price IS NOT NULL THEN
    RETURN v_price;
  END IF;

  -- National fallback from system_settings
  v_default := get_setting('default_base_price_per_sqm', '1000')::DECIMAL;
  RETURN v_default;
END;
$$;

-- ============================================================
-- SEED QQP CATEGORIES
-- ============================================================

INSERT INTO qqp_categories (name, display_name, description, sort_order) VALUES
  ('size_layout', 'Size & Layout', 'Room sizes and spatial arrangement', 1),
  ('room_count', 'Room Count & Composition', 'Number and types of rooms', 2),
  ('equipment', 'Equipment & Features', 'Built-in appliances, fixtures, materials', 3),
  ('proportionality', 'Proportionality', 'Derived ratios between spaces', 4);
