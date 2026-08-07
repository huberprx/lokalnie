-- Bogatsze podpowiedzi lokalizacji: nazwa + powiat/województwo + lista sugestii.
ALTER TABLE geocode_cache ADD COLUMN name TEXT;
ALTER TABLE geocode_cache ADD COLUMN county TEXT;
ALTER TABLE geocode_cache ADD COLUMN state TEXT;
ALTER TABLE geocode_cache ADD COLUMN suggestions_json TEXT;
