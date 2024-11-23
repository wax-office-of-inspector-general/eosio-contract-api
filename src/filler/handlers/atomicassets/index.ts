import * as fs from 'fs';
import { PoolClient } from 'pg';

import { ContractHandler } from '../interfaces';
import logger from '../../../utils/winston';
import { ConfigTableRow, TokenConfigsTableRow } from './types/tables';
import DataProcessor from '../../processor';
import ApiNotificationSender from '../../notifier';
import { assetProcessor } from './processors/assets';
import { balanceProcessor } from './processors/balances';
import { collectionProcessor } from './processors/collections';
import { configProcessor } from './processors/config';
import { logProcessor } from './processors/logs';
import { offerProcessor } from './processors/offers';
import { schemaProcessor } from './processors/schemas';
import { templateProcessor } from './processors/templates';
import Filler  from '../../filler';
import { JobQueuePriority } from '../../jobqueue';

export const ATOMICASSETS_BASE_PRIORITY = 0;

export enum OfferState {
    PENDING = 0,
    INVALID = 1,
    UNKNOWN = 2,
    ACCEPTED = 3,
    DECLINED = 4,
    CANCELLED = 5
}

export enum AtomicAssetsUpdatePriority {
    INDEPENDENT = ATOMICASSETS_BASE_PRIORITY + 10,
    TABLE_BALANCES = ATOMICASSETS_BASE_PRIORITY + 10,
    TABLE_CONFIG = ATOMICASSETS_BASE_PRIORITY + 10,
    TABLE_COLLECTIONS = ATOMICASSETS_BASE_PRIORITY + 20,
    TABLE_SCHEMAS = ATOMICASSETS_BASE_PRIORITY + 20,
    TABLE_TEMPLATES = ATOMICASSETS_BASE_PRIORITY + 40,
    ACTION_MINT_ASSET = ATOMICASSETS_BASE_PRIORITY + 50,
    ACTION_UPDATE_ASSET = ATOMICASSETS_BASE_PRIORITY + 60,
    ACTION_CREATE_OFFER = ATOMICASSETS_BASE_PRIORITY + 80,
    ACTION_UPDATE_OFFER = ATOMICASSETS_BASE_PRIORITY + 90,
    LOGS = 0
}

export type AtomicAssetsReaderArgs = {
    atomicassets_account: string,
    store_transfers: boolean,
    store_logs: boolean
};

export default class AtomicAssetsHandler extends ContractHandler {
    static handlerName = 'atomicassets';

    declare readonly args: AtomicAssetsReaderArgs;

    config: ConfigTableRow;
    tokenconfigs: TokenConfigsTableRow;

    static views = [
        'atomicassets_assets_master', 'atomicassets_asset_mints_master', 'atomicassets_templates_master',
        'atomicassets_schemas_master', 'atomicassets_collections_master', 'atomicassets_offers_master',
        'atomicassets_transfers_master', 'atomicassets_moves_master'
    ];

    static procedures = ['update_atomicassets_mints'];

    static async setup(client: PoolClient): Promise<boolean> {
        const existsQuery = await client.query(
            'SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2)',
            ['public', 'atomicassets_config']
        );

        if (!existsQuery.rows[0].exists) {
            logger.info('Could not find AtomicAssets tables. Create them now...');

            await client.query(fs.readFileSync('./definitions/tables/atomicassets_tables.sql', {
                encoding: 'utf8'
            }));

            logger.info('AtomicAssets tables successfully created');

            return true;
        }

        return false;
    }

    static async beginUpgrade(client: PoolClient): Promise<void> {
        for (const view of AtomicAssetsHandler.views.reverse()) {
            await client.query('DROP VIEW IF EXISTS "' + view + '" CASCADE;');
        }

        for (const procedure of AtomicAssetsHandler.procedures.reverse()) {
            await client.query('DROP PROCEDURE IF EXISTS "' + procedure + '" CASCADE;');
        }
    }

    static async finishUpgrade(client: PoolClient): Promise<void> {
        for (const view of AtomicAssetsHandler.views) {
            await client.query(fs.readFileSync('./definitions/views/' + view + '.sql', {encoding: 'utf8'}));
        }

        for (const procedure of AtomicAssetsHandler.procedures) {
            await client.query(fs.readFileSync('./definitions/procedures/' + procedure + '.sql', {encoding: 'utf8'}));
        }
    }

    constructor(filler: Filler, args: {[key: string]: any}) {
        super(filler, args);

        if (typeof args.atomicassets_account !== 'string') {
            throw new Error('AtomicAssets: Argument missing in atomicassets handler: atomicassets_account');
        }

        if (!this.args.store_logs) {
            logger.warn('AtomicAssets: disabled store_logs');
        }

        if (!this.args.store_transfers) {
            logger.warn('AtomicAssets: disabled store_transfers');
        }
    }

    async init(client: PoolClient): Promise<void> {
        const configQuery = await client.query(
            'SELECT * FROM atomicassets_config WHERE contract = $1',
            [this.args.atomicassets_account]
        );

        if (configQuery.rows.length === 0) {
            const tokenconfigsTable = await this.connection.chain.rpc.get_table_rows({
                json: true, code: this.args.atomicassets_account,
                scope: this.args.atomicassets_account, table: 'tokenconfigs'
            });

            if (tokenconfigsTable.rows[0].standard !== 'atomicassets') {
                throw new Error('AtomicAssets: Contract not deployed on the account');
            }

            this.config = {
                supported_tokens: [],
                asset_counter: 0,
                offer_counter: 0,
                collection_format: []
            };

            this.tokenconfigs = {
                version: tokenconfigsTable.rows[0].version,
                standard: tokenconfigsTable.rows[0].standard
            };

            if (tokenconfigsTable.rows.length > 0) {
                await client.query(
                    'INSERT INTO atomicassets_config (contract, version, collection_format) VALUES ($1, $2, $3)',
                    [this.args.atomicassets_account, tokenconfigsTable.rows[0].version, []]
                );
            } else {
                throw new Error('AtomicAssets: Tokenconfigs table empty');
            }
        } else {
            const tokensQuery = await this.connection.database.query(
                'SELECT * FROM atomicassets_tokens WHERE contract = $1',
                [this.args.atomicassets_account]
            );

            this.config = {
                supported_tokens: tokensQuery.rows.map(row => ({
                    contract: row.token_contract,
                    sym: row.token_precision + ',' + row.token_symbol
                })),
                asset_counter: 0,
                offer_counter: 0,
                collection_format: configQuery.rows[0].collection_format
            };

            this.tokenconfigs = {
                version: configQuery.rows[0].version,
                standard: 'atomicassets'
            };
        }

        const chainInfo = await this.connection.chain.rpc.get_info();
        const irreversibleBlockQuery = await this.connection.database.query(
            'SELECT MIN(block_num) "block" FROM reversible_blocks WHERE reader = $1',
            [this.filler.reader.name]
        );
        const lastIrreversibleBlock = irreversibleBlockQuery.rows[0].block ? (irreversibleBlockQuery.rows[0].block - 1) : chainInfo.last_irreversible_block_num;

        logger.info('Check for missing mint numbers of ' + this.args.atomicassets_account + '. Last irreversible block #' + lastIrreversibleBlock);

        const contractsQuery = await this.connection.database.query('SELECT * FROM atomicassets_config');

        for (const row of contractsQuery.rows) {
            let emptyMints;

            do {
                if (emptyMints) {
                    await this.connection.database.query(
                        'CALL update_atomicassets_mints($1, $2)',
                        [row.contract, lastIrreversibleBlock]
                    );

                    logger.info(emptyMints + ' missing asset mints for contract ' + row.contract);
                }

                const countQuery = await this.connection.database.query(
                    'SELECT COUNT(*) "count" FROM atomicassets_assets WHERE template_id IS NOT NULL AND template_mint IS NULL AND contract = $1 AND minted_at_block <= $2',
                    [row.contract, lastIrreversibleBlock]
                );

                emptyMints = countQuery.rows[0].count;
            } while (emptyMints > 50000);
        }
    }

    async deleteDB(client: PoolClient): Promise<void> {
        const tables = [
            'atomicassets_assets', 'atomicassets_assets_backed_tokens', 'atomicassets_mints',
            'atomicassets_balances', 'atomicassets_collections', 'atomicassets_config',
            'atomicassets_offers', 'atomicassets_offers_assets',
            'atomicassets_templates', 'atomicassets_schemas',
            'atomicassets_tokens', 'atomicassets_transfers', 'atomicassets_transfers_assets'
        ];

        for (const table of tables) {
            await client.query(
                'DELETE FROM ' + client.escapeIdentifier(table) + ' WHERE contract = $1',
                [this.args.atomicassets_account]
            );
        }
    }

    async register(processor: DataProcessor, notifier: ApiNotificationSender): Promise<() => any> {
        const destructors: Array<() => any> = [];

        destructors.push(assetProcessor(this, processor, notifier));
        destructors.push(balanceProcessor(this, processor));
        destructors.push(collectionProcessor(this, processor));
        destructors.push(configProcessor(this, processor));
        destructors.push(offerProcessor(this, processor, notifier));
        destructors.push(schemaProcessor(this, processor));
        destructors.push(templateProcessor(this, processor));

        if (this.args.store_logs) {
            destructors.push(logProcessor(this, processor));
        }

        this.filler.jobs.add('aggregate atomicassets_asset_counts', 60 * 10, JobQueuePriority.LOW, async () => {
            await this.connection.database.query(
                `
                WITH del AS (
                    DELETE FROM atomicassets_asset_counts
                    WHERE (contract, collection_name, schema_name, template_id) IN (
                        SELECT contract, collection_name, schema_name,template_id FROM atomicassets_asset_counts WHERE dirty AND contract = $1
                    )
                    RETURNING contract, collection_name, schema_name, template_id, assets, burned, owned
                )
                    INSERT INTO atomicassets_asset_counts(contract, collection_name, schema_name, template_id, assets, burned, owned, dirty)
                        SELECT contract, collection_name, schema_name, template_id,
                            COALESCE(SUM(assets)::INT, 0), COALESCE(SUM(burned)::INT, 0), COALESCE(SUM(owned)::INT, 0), NULL
                        FROM del
                        GROUP BY contract, collection_name, schema_name, template_id 
                        HAVING COALESCE(SUM(assets)::INT, 0) != 0
                `,
                [this.args.atomicassets_account]
            );
        });

        this.filler.jobs.add('update_atomicassets_mints', 30, JobQueuePriority.MEDIUM, async () => {
            await this.connection.database.query(
                'CALL update_atomicassets_mints($1, $2)',
                [this.args.atomicassets_account, this.filler.reader.lastIrreversibleBlock]
            );
        });

        return (): any => destructors.map(fn => fn());
    }
}
