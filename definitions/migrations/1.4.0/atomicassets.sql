ALTER TABLE atomicassets_assets ADD COLUMN holder CHARACTER VARYING(13);
UPDATE atomicassets_assets SET holder = "owner";

ALTER TABLE atomicassets_collections ADD COLUMN new_author_name CHARACTER VARYING(13);
ALTER TABLE atomicassets_collections ADD COLUMN new_author_date BIGINT;

ALTER TABLE atomicassets_schemas ADD COLUMN types JSONB[] NOT NULL DEFAULT ARRAY[]::JSONB[];

ALTER TABLE atomicassets_templates ADD COLUMN mutable_data JSONB;
ALTER TABLE atomicassets_templates ADD COLUMN deleted_at_block BIGINT;
ALTER TABLE atomicassets_templates ADD COLUMN deleted_at_time BIGINT;
