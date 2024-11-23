import * as fs from 'fs';
import { PoolClient } from 'pg';

import { ContractHandler } from '../interfaces';
import logger from '../../../utils/winston';
import { ConfigTableRow } from './types/tables';
import Filler  from '../../filler';
import { DELPHIORACLE_BASE_PRIORITY } from '../delphioracle';
import { ATOMICASSETS_BASE_PRIORITY } from '../atomicassets';
import DataProcessor from '../../processor';
import ApiNotificationSender from '../../notifier';
import { auctionProcessor } from './processors/auctions';
import { balanceProcessor } from './processors/balances';
import { configProcessor } from './processors/config';
import { logProcessor } from './processors/logs';
import { marketplaceProcessor } from './processors/marketplaces';
import { saleProcessor } from './processors/sales';
import { buyofferProcessor } from './processors/buyoffers';
import { bonusfeeProcessor } from './processors/bonusfees';
import { JobQueuePriority } from '../../jobqueue';
import { templateBuyofferProcessor } from './processors/template-buyoffers';

export const ATOMICMARKET_BASE_PRIORITY = Math.max(ATOMICASSETS_BASE_PRIORITY, DELPHIORACLE_BASE_PRIORITY) + 1000;

export type AtomicMarketArgs = {
    atomicmarket_account: string,
    atomicassets_account: string,
    delphioracle_account: string,

    store_logs: boolean
};

export enum SaleState {
    WAITING = 0,
    LISTED = 1,
    CANCELED = 2,
    SOLD = 3
}

export enum AuctionState {
    WAITING = 0,
    LISTED = 1,
    CANCELED = 2
}

export enum BuyofferState {
    PENDING = 0,
    DECLINED = 1,
    CANCELED = 2,
    ACCEPTED = 3
}

export enum TemplateBuyofferState {
    LISTED = 0,
    CANCELED = 1,
    SOLD = 2
}

export enum AtomicMarketUpdatePriority {
    TABLE_BALANCES = ATOMICMARKET_BASE_PRIORITY + 10,
    TABLE_MARKETPLACES = ATOMICMARKET_BASE_PRIORITY + 10,
    TABLE_CONFIG = ATOMICMARKET_BASE_PRIORITY + 10,
    TABLE_BONUSFEES = ATOMICMARKET_BASE_PRIORITY + 10,
    ACTION_CREATE_SALE = ATOMICMARKET_BASE_PRIORITY + 20,
    ACTION_CREATE_AUCTION = ATOMICMARKET_BASE_PRIORITY + 20,
    ACTION_CREATE_BUYOFFER = ATOMICMARKET_BASE_PRIORITY + 20,
    ACTION_CREATE_TEMPLATE_BUYOFFER = ATOMICMARKET_BASE_PRIORITY + 20,
    TABLE_AUCTIONS = ATOMICMARKET_BASE_PRIORITY + 30,
    ACTION_UPDATE_SALE = ATOMICMARKET_BASE_PRIORITY + 40,
    ACTION_UPDATE_AUCTION = ATOMICMARKET_BASE_PRIORITY + 40,
    ACTION_UPDATE_BUYOFFER = ATOMICMARKET_BASE_PRIORITY + 40,
    ACTION_UPDATE_TEMPLATE_BUYOFFER = ATOMICMARKET_BASE_PRIORITY + 40,
    LOGS = ATOMICMARKET_BASE_PRIORITY
}

export default class AtomicMarketHandler extends ContractHandler {
    static handlerName = 'atomicmarket';

    declare readonly args: AtomicMarketArgs;

    config: ConfigTableRow;

    static views = [
        'atomicmarket_assets_master', 'atomicmarket_auctions_master',
        'atomicmarket_sales_master', 'atomicmarket_sale_prices_master',
        'atomicmarket_stats_prices_master', 'atomicmarket_buyoffers_master',
        'atomicmarket_template_buyoffers_master'
    ];

    static procedures = [
        'update_atomicmarket_auction_mints',
        'update_atomicmarket_buyoffer_mints',
        'update_atomicmarket_sale_mints',
        'update_atomicmarket_template_buyoffer_mints'
    ]

    static async setup(client: PoolClient): Promise<boolean> {
        const existsQuery = await client.query(
            'SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2)',
            ['public', 'atomicmarket_config']
        );

        if (!existsQuery.rows[0].exists) {
            logger.info('Could not find AtomicMarket tables. Create them now...');

            await client.query(fs.readFileSync('./definitions/tables/atomicmarket_tables.sql', {
                encoding: 'utf8'
            }));

            logger.info('AtomicMarket tables successfully created');

            return true;
        }

        return false;
    }

    static async beginUpgrade(client: PoolClient): Promise<void> {
        for (const view of AtomicMarketHandler.views.reverse()) {
            await client.query('DROP VIEW IF EXISTS "' + view + '" CASCADE;');
        }

        for (const procedure of AtomicMarketHandler.procedures.reverse()) {
            await client.query('DROP PROCEDURE IF EXISTS "' + procedure + '" CASCADE;');
        }
    }

    static async finishUpgrade(client: PoolClient): Promise<void> {
        for (const view of AtomicMarketHandler.views) {
            await client.query(fs.readFileSync('./definitions/views/' + view + '.sql', {encoding: 'utf8'}));
        }

        for (const procedure of AtomicMarketHandler.procedures) {
            await client.query(fs.readFileSync('./definitions/procedures/' + procedure + '.sql', {encoding: 'utf8'}));
        }
    }

    constructor(filler: Filler, args: {[key: string]: any}) {
        super(filler, args);

        if (typeof args.atomicmarket_account !== 'string') {
            throw new Error('AtomicMarket: Argument missing in atomicmarket handler: atomicmarket_account');
        }
    }

    async init(client: PoolClient): Promise<void> {
        const configQuery = await client.query(
            'SELECT * FROM atomicmarket_config WHERE market_contract = $1',
            [this.args.atomicmarket_account]
        );

        if (configQuery.rows.length === 0) {
            const configTable = await this.connection.chain.rpc.get_table_rows({
                json: true, code: this.args.atomicmarket_account,
                scope: this.args.atomicmarket_account, table: 'config'
            });

            if (configTable.rows.length === 0) {
                throw new Error('AtomicMarket: Unable to fetch atomicmarket version');
            }

            const config: ConfigTableRow = configTable.rows[0];

            this.args.delphioracle_account = config.delphioracle_account;
            this.args.atomicassets_account = config.atomicassets_account;

            await client.query(
                'INSERT INTO atomicmarket_config ' +
                '(' +
                    'market_contract, assets_contract, delphi_contract, ' +
                    'version, maker_market_fee, taker_market_fee, ' +
                    'minimum_auction_duration, maximum_auction_duration, ' +
                    'minimum_bid_increase, auction_reset_duration' +
                ') ' +
                'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
                [
                    this.args.atomicmarket_account,
                    this.args.atomicassets_account,
                    config.delphioracle_account,
                    config.version,
                    config.maker_market_fee,
                    config.taker_market_fee,
                    config.minimum_auction_duration,
                    config.maximum_auction_duration,
                    config.minimum_bid_increase,
                    config.auction_reset_duration
                ]
            );

            this.config = {
                ...config,
                supported_symbol_pairs: [],
                supported_tokens: []
            };
        } else {
            this.args.delphioracle_account = configQuery.rows[0].delphi_contract;
            this.args.atomicassets_account = configQuery.rows[0].assets_contract;

            const tokensQuery = await this.connection.database.query(
                'SELECT * FROM atomicmarket_tokens WHERE market_contract = $1',
                [this.args.atomicmarket_account]
            );

            const pairsQuery = await this.connection.database.query(
                'SELECT * FROM atomicmarket_symbol_pairs WHERE market_contract = $1',
                [this.args.atomicmarket_account]
            );

            this.config = {
                ...configQuery.rows[0],
                supported_symbol_pairs: pairsQuery.rows.map(row => ({
                    listing_symbol: 'X,' + row.listing_symbol,
                    settlement_symbol: 'X,' + row.settlement_symbol,
                    invert_delphi_pair: row.invert_delphi_pair,
                    delphi_pair_name: row.delphi_pair_name
                })),
                supported_tokens: tokensQuery.rows.map(row => ({
                    token_contract: row.token_contract,
                    token_symbol: row.token_precision + ',' + row.token_symbol
                })),
                auction_counter: 0,
                sale_counter: 0,
                delphioracle_account: this.args.delphioracle_account,
                atomicassets_account: this.args.atomicassets_account
            };
        }
    }

    async deleteDB(client: PoolClient): Promise<void> {
        const tables = [
            'atomicmarket_auctions', 'atomicmarket_auctions_assets', 'atomicmarket_auctions_bids',
            'atomicmarket_sales', 'atomicmarket_buyoffers', 'atomicmarket_buyoffers_assets',
            'atomicmarket_config', 'atomicmarket_delphi_pairs', 'atomicmarket_marketplaces',
            'atomicmarket_token_symbols', 'atomicmarket_bonusfees', 'atomicmarket_balances',
            'atomicmarket_stats_markets', 'atomicmarket_template_prices',
            'atomicmarket_template_buyoffers', 'atomicmarket_template_buyoffers_assets',
        ];

        for (const table of tables) {
            await client.query(
                'DELETE FROM ' + client.escapeIdentifier(table) + ' WHERE market_contract = $1',
                [this.args.atomicmarket_account]
            );
        }
    }

    async register(processor: DataProcessor, notifier: ApiNotificationSender): Promise<() => any> {
        const destructors: Array<() => any> = [];

        destructors.push(auctionProcessor(this, processor, notifier));
        destructors.push(balanceProcessor(this, processor));
        destructors.push(bonusfeeProcessor(this, processor));
        destructors.push(buyofferProcessor(this, processor, notifier));
        destructors.push(templateBuyofferProcessor(this, processor, notifier));
        destructors.push(configProcessor(this, processor));
        destructors.push(marketplaceProcessor(this, processor));
        destructors.push(saleProcessor(this, processor, notifier));

        if (this.args.store_logs) {
            destructors.push(logProcessor(this, processor));
        }

        this.filler.jobs.add('update_atomicmarket_sale_mints', 60, JobQueuePriority.MEDIUM, async () => {
            await this.connection.database.query(
                'CALL update_atomicmarket_sale_mints($1, $2)',
                [this.args.atomicmarket_account, this.filler.reader.lastIrreversibleBlock]
            );
        });

        this.filler.jobs.add('update_atomicmarket_buyoffer_mints', 60, JobQueuePriority.MEDIUM, async () => {
            await this.connection.database.query(
                'CALL update_atomicmarket_buyoffer_mints($1, $2)',
                [this.args.atomicmarket_account, this.filler.reader.lastIrreversibleBlock]
            );
        });

        this.filler.jobs.add('update_atomicmarket_auction_mints', 60, JobQueuePriority.MEDIUM, async () => {
            await this.connection.database.query(
                'CALL update_atomicmarket_auction_mints($1, $2)',
                [this.args.atomicmarket_account, this.filler.reader.lastIrreversibleBlock]
            );
        });

        this.filler.jobs.add('update_atomicmarket_sales_filters', 20, JobQueuePriority.HIGH, async () => {
            await this.connection.database.query(
                'SELECT update_atomicmarket_sales_filters()'
            );

            await this.connection.database.query(
                'VACUUM atomicmarket_sales_filters_listed'
            );
        });

        this.filler.jobs.add('refresh_atomicmarket_sales_filters_price', 60 * 60, JobQueuePriority.LOW, async () => {
            await this.connection.database.query(
                'SELECT refresh_atomicmarket_sales_filters_price()'
            );
        });

        this.filler.jobs.add('update_atomicmarket_stats_market', 60 * 2, JobQueuePriority.MEDIUM, async () => {
            await this.connection.database.query(
                'SELECT update_atomicmarket_stats_market()'
            );
        });

        this.filler.jobs.add('update_atomicmarket_template_prices', 60 * 60, JobQueuePriority.LOW, async () => {
            await this.connection.database.query(
                'SELECT update_atomicmarket_template_prices()'
            );
        });

        return (): any => destructors.map(fn => fn());
    }
}
