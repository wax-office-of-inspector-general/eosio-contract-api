ALTER TABLE atomicassets_assets ADD COLUMN holder CHARACTER VARYING(13);
UPDATE atomicassets_assets SET holder = "owner";

ALTER TABLE atomicassets_collections ADD COLUMN new_author_name CHARACTER VARYING(13);
ALTER TABLE atomicassets_collections ADD COLUMN new_author_date BIGINT;

ALTER TABLE atomicassets_schemas ADD COLUMN types JSONB[] NOT NULL DEFAULT ARRAY[]::JSONB[];

ALTER TABLE atomicassets_templates ADD COLUMN mutable_data JSONB;
ALTER TABLE atomicassets_templates ADD COLUMN deleted_at_block BIGINT;
ALTER TABLE atomicassets_templates ADD COLUMN deleted_at_time BIGINT;

CREATE TABLE atomicassets_moves (
    move_id bigint NOT NULL,
    contract character varying(12) NOT NULL,
    "sender" character varying(12) NOT NULL,
    "recipient" character varying(12) NOT NULL,
    memo character varying(256) NOT NULL,
    txid bytea NOT NULL,
    created_at_block bigint NOT NULL,
    created_at_time bigint NOT NULL,
    CONSTRAINT atomicassets_moves_pkey PRIMARY KEY (contract, move_id)
);

CREATE TABLE atomicassets_moves_assets (
    move_id bigint NOT NULL,
    contract character varying(12) NOT NULL,
    "index" integer NOT NULL,
    asset_id bigint NOT NULL,
    CONSTRAINT atomicassets_moves_assets_pkey PRIMARY KEY (move_id, contract, asset_id)
);
