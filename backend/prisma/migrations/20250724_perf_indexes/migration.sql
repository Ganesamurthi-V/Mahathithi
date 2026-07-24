-- Performance indexes for stakeholder search over 295K rows
-- Safe to run repeatedly (IF NOT EXISTS everywhere)

-- pg_trgm enables GIN trigram indexes for fast ILIKE '%term%' (leading-wildcard) search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trigram GIN indexes for the fuzzy name/company/city searches.
-- Without these, `contains` (ILIKE '%x%') degrades to a sequential scan of 295K rows.
CREATE INDEX IF NOT EXISTS idx_sh_name_std_trgm
  ON stakeholders USING gin (company_name_standardized gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_sh_name_orig_trgm
  ON stakeholders USING gin (company_name_original gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_sh_city_trgm
  ON stakeholders USING gin (city gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_sh_gst_trgm
  ON stakeholders USING gin (gst_number gin_trgm_ops);

-- The default list + search ORDER BY priority_weight DESC, company_name_standardized ASC
-- had no supporting index, forcing a sort over the whole filtered set on every request.
CREATE INDEX IF NOT EXISTS idx_sh_priority_sort
  ON stakeholders (priority_weight DESC NULLS LAST, company_name_standardized ASC);

-- Common browse: district-scoped, priority-ordered (matches enumerator's assigned-district view)
CREATE INDEX IF NOT EXISTS idx_sh_district_priority
  ON stakeholders (district, priority_weight DESC NULLS LAST);
