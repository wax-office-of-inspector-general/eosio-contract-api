DROP VIEW IF EXISTS atomicmarket_sales_master;
DROP VIEW IF EXISTS atomicmarket_auctions_master;
DROP VIEW IF EXISTS atomicmarket_buyoffers_master;
DROP VIEW IF EXISTS atomicmarket_template_buyoffers_master;

ALTER TABLE atomicmarket_marketplaces ALTER COLUMN marketplace_name TYPE CHARACTER VARYING(13);
ALTER TABLE atomicmarket_sales ALTER COLUMN maker_marketplace TYPE CHARACTER VARYING(13);
ALTER TABLE atomicmarket_sales ALTER COLUMN taker_marketplace TYPE CHARACTER VARYING(13);
ALTER TABLE atomicmarket_sales_filters ALTER COLUMN maker_marketplace TYPE CHARACTER VARYING(13);
ALTER TABLE atomicmarket_sales_filters ALTER COLUMN taker_marketplace TYPE CHARACTER VARYING(13);
ALTER TABLE atomicmarket_auctions ALTER COLUMN maker_marketplace TYPE CHARACTER VARYING(13);
ALTER TABLE atomicmarket_auctions ALTER COLUMN taker_marketplace TYPE CHARACTER VARYING(13);
ALTER TABLE atomicmarket_buyoffers ALTER COLUMN maker_marketplace TYPE CHARACTER VARYING(13);
ALTER TABLE atomicmarket_buyoffers ALTER COLUMN taker_marketplace TYPE CHARACTER VARYING(13);
ALTER TABLE atomicmarket_template_buyoffers ALTER COLUMN maker_marketplace TYPE CHARACTER VARYING(13);
ALTER TABLE atomicmarket_template_buyoffers ALTER COLUMN taker_marketplace TYPE CHARACTER VARYING(13);
ALTER TABLE atomicmarket_stats_markets ALTER COLUMN maker_marketplace TYPE CHARACTER VARYING(13);
ALTER TABLE atomicmarket_stats_markets ALTER COLUMN taker_marketplace TYPE CHARACTER VARYING(13);
