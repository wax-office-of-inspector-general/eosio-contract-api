import AtomicAssetsHandler, { AtomicAssetsUpdatePriority } from '../index';
import DataProcessor from '../../../processor';
import { ContractDBTransaction } from '../../../database';
import { EosioActionTrace, EosioTransaction } from '../../../../types/eosio';
import {
    LogBackAssetActionData,
    LogBurnAssetActionData,
    LogMintAssetActionData, LogMoveActionData,
    LogSetDataActionData,
    LogTransferActionData
} from '../types/actions';
import { ShipBlock } from '../../../../types/ship';
import { eosioTimestampToDate, splitEosioToken } from '../../../../utils/eosio';
import { convertAttributeMapToObject } from '../utils';
import ApiNotificationSender from '../../../notifier';
import { arrayChunk } from '../../../../utils';
import { encodeDatabaseJson } from '../../../utils';

export function assetProcessor(core: AtomicAssetsHandler, processor: DataProcessor, notifier: ApiNotificationSender): () => any {
    const destructors: Array<() => any> = [];
    const contract = core.args.atomicassets_account;

    let tableInserts = {
        'assets': <any[]>[],
        'mints': <any[]>[]
    };

    destructors.push(processor.onActionTrace(
        contract, 'logmint',
        async (db: ContractDBTransaction, block: ShipBlock, tx: EosioTransaction, trace: EosioActionTrace<LogMintAssetActionData>): Promise<void> => {
            tableInserts.assets.push({
                contract: contract,
                asset_id: trace.act.data.asset_id,
                collection_name: trace.act.data.collection_name,
                schema_name: trace.act.data.schema_name,
                template_id: trace.act.data.template_id === -1 ? null : trace.act.data.template_id,
                owner: trace.act.data.new_asset_owner,
                holder: trace.act.data.new_asset_owner,
                mutable_data: encodeDatabaseJson(convertAttributeMapToObject(trace.act.data.mutable_data)),
                immutable_data: encodeDatabaseJson(convertAttributeMapToObject(trace.act.data.immutable_data)),
                burned_by_account: null,
                burned_at_block: null,
                burned_at_time: null,
                transferred_at_block: block.block_num,
                transferred_at_time: eosioTimestampToDate(block.timestamp).getTime(),
                updated_at_block: block.block_num,
                updated_at_time: eosioTimestampToDate(block.timestamp).getTime(),
                minted_at_block: block.block_num,
                minted_at_time: eosioTimestampToDate(block.timestamp).getTime()
            });

            tableInserts.mints.push({
                contract: contract,
                asset_id: trace.act.data.asset_id,
                receiver: trace.act.data.new_asset_owner,
                minter: trace.act.data.authorized_minter,
                txid: Buffer.from(tx.id, 'hex')
            });

            notifier.sendActionTrace('assets', block, tx, trace);
        }, AtomicAssetsUpdatePriority.ACTION_MINT_ASSET.valueOf()
    ));

    destructors.push(processor.onPriorityComplete(AtomicAssetsUpdatePriority.ACTION_MINT_ASSET.valueOf(),
        async (db: ContractDBTransaction) => {
            if (tableInserts.assets.length > 0) {
                const chunks = arrayChunk(tableInserts.assets, 50);

                for (const chunk of chunks) {
                    await db.insert('atomicassets_assets', chunk, ['contract', 'asset_id']);
                }
            }

            if (tableInserts.mints.length > 0) {
                const chunks = arrayChunk(tableInserts.mints, 50);

                for (const chunk of chunks) {
                    await db.insert('atomicassets_mints', chunk, ['contract', 'asset_id']);
                }
            }

            tableInserts = {
                'assets': [],
                'mints': []
            };
        }, AtomicAssetsUpdatePriority.ACTION_MINT_ASSET.valueOf()
    ));

    destructors.push(processor.onActionTrace(
        contract, 'logbackasset',
        async (db: ContractDBTransaction, block: ShipBlock, tx: EosioTransaction, trace: EosioActionTrace<LogBackAssetActionData>): Promise<void> => {
            const token = splitEosioToken(trace.act.data.backed_token);
            const backedToken = await db.query(
                'SELECT amount FROM atomicassets_assets_backed_tokens WHERE contract = $1 AND asset_id = $2 AND token_symbol = $3',
                [contract, trace.act.data.asset_id, token.token_symbol]
            );

            if (backedToken.rowCount > 0) {
                await db.update('atomicassets_assets_backed_tokens', {
                    amount: String(BigInt(token.amount) + BigInt(backedToken.rows[0].amount)),
                    updated_at_block: block.block_num,
                    updated_at_time: eosioTimestampToDate(block.timestamp).getTime(),
                }, {
                    str: 'contract = $1 AND asset_id = $2 AND token_symbol = $3',
                    values: [contract, trace.act.data.asset_id, token.token_symbol]
                }, ['contract', 'asset_id', 'token_symbol']);
            } else {
                await db.insert('atomicassets_assets_backed_tokens', {
                    contract: contract,
                    asset_id: trace.act.data.asset_id,
                    token_symbol: token.token_symbol,
                    amount: token.amount,
                    updated_at_block: block.block_num,
                    updated_at_time: eosioTimestampToDate(block.timestamp).getTime(),
                }, ['contract', 'asset_id', 'token_symbol']);
            }

            notifier.sendActionTrace('assets', block, tx, trace);
        }, AtomicAssetsUpdatePriority.ACTION_UPDATE_ASSET.valueOf()
    ));

    destructors.push(processor.onActionTrace(
        contract, 'logburnasset',
        async (db: ContractDBTransaction, block: ShipBlock, tx: EosioTransaction, trace: EosioActionTrace<LogBurnAssetActionData>): Promise<void> => {
            await db.update('atomicassets_assets', {
                owner: null,
                burned_by_account: trace.act.data.asset_owner,
                burned_at_block: block.block_num,
                burned_at_time: eosioTimestampToDate(block.timestamp).getTime(),
                updated_at_block: block.block_num,
                updated_at_time: eosioTimestampToDate(block.timestamp).getTime(),
            }, {
                str: 'contract = $1 AND asset_id = $2',
                values: [contract, trace.act.data.asset_id]
            }, ['contract', 'asset_id']);

            notifier.sendActionTrace('assets', block, tx, trace);
        }, AtomicAssetsUpdatePriority.ACTION_UPDATE_ASSET.valueOf()
    ));

    destructors.push(processor.onActionTrace(
        contract, 'logsetdata',
        async (db: ContractDBTransaction, block: ShipBlock, tx: EosioTransaction, trace: EosioActionTrace<LogSetDataActionData>): Promise<void> => {
            await db.update('atomicassets_assets', {
                mutable_data: encodeDatabaseJson(convertAttributeMapToObject(trace.act.data.new_data)),
                updated_at_block: block.block_num,
                updated_at_time: eosioTimestampToDate(block.timestamp).getTime(),
            }, {
                str: 'contract = $1 AND asset_id = $2',
                values: [contract, trace.act.data.asset_id]
            }, ['contract', 'asset_id']);

            notifier.sendActionTrace('assets', block, tx, trace);
        }, AtomicAssetsUpdatePriority.ACTION_UPDATE_ASSET.valueOf()
    ));

    destructors.push(processor.onActionTrace(
        contract, 'logtransfer',
        async (db: ContractDBTransaction, block: ShipBlock, tx: EosioTransaction, trace: EosioActionTrace<LogTransferActionData>): Promise<void> => {
            await db.update('atomicassets_assets', {
                owner: trace.act.data.to,
                holder: trace.act.data.to,
                transferred_at_block: block.block_num,
                transferred_at_time: eosioTimestampToDate(block.timestamp).getTime(),
                updated_at_block: block.block_num,
                updated_at_time: eosioTimestampToDate(block.timestamp).getTime(),
            }, {
                str: 'contract = $1 AND asset_id = ANY ($2) AND owner = $3',
                values: [contract, trace.act.data.asset_ids, trace.act.data.from]
            }, ['contract', 'asset_id']);

            if (core.args.store_transfers) {
                await db.insert('atomicassets_transfers', {
                    contract: contract,
                    transfer_id: trace.global_sequence,
                    sender: trace.act.data.from,
                    recipient: trace.act.data.to,
                    memo: String(trace.act.data.memo).substr(0, 256),
                    txid: Buffer.from(tx.id, 'hex'),
                    created_at_block: block.block_num,
                    created_at_time: eosioTimestampToDate(block.timestamp).getTime()
                }, ['contract', 'transfer_id']);

                await db.insert('atomicassets_transfers_assets', trace.act.data.asset_ids.map((assetID, index) => ({
                    transfer_id: trace.global_sequence,
                    contract: contract,
                    index: index + 1,
                    asset_id: assetID
                })), ['contract', 'transfer_id', 'asset_id']);
            }

            notifier.sendActionTrace('transfers', block, tx, trace);
        }, AtomicAssetsUpdatePriority.ACTION_UPDATE_ASSET.valueOf()
    ));

    destructors.push(processor.onActionTrace(
        contract, 'logmove',
        async (db: ContractDBTransaction, block: ShipBlock, tx: EosioTransaction, trace: EosioActionTrace<LogMoveActionData>): Promise<void> => {
            await db.update('atomicassets_assets', {
                owner: trace.act.data.owner,
                holder: trace.act.data.to,
                transferred_at_block: block.block_num,
                transferred_at_time: eosioTimestampToDate(block.timestamp).getTime(),
                updated_at_block: block.block_num,
                updated_at_time: eosioTimestampToDate(block.timestamp).getTime(),
            }, {
                str: 'contract = $1 AND asset_id = ANY ($2)',
                values: [contract, trace.act.data.asset_ids]
            }, ['contract', 'asset_id']);

            if (core.args.store_transfers) {
                await db.insert('atomicassets_moves', {
                    contract: contract,
                    move_id: trace.global_sequence,
                    sender: trace.act.data.from,
                    recipient: trace.act.data.to,
                    memo: String(trace.act.data.memo).substr(0, 256),
                    txid: Buffer.from(tx.id, 'hex'),
                    created_at_block: block.block_num,
                    created_at_time: eosioTimestampToDate(block.timestamp).getTime()
                }, ['contract', 'move_id']);

                await db.insert('atomicassets_moves_assets', trace.act.data.asset_ids.map((assetID, index) => ({
                    move_id: trace.global_sequence,
                    contract: contract,
                    index: index + 1,
                    asset_id: assetID
                })), ['contract', 'move_id', 'asset_id']);
            }

            notifier.sendActionTrace('transfers', block, tx, trace);
        }, AtomicAssetsUpdatePriority.ACTION_UPDATE_ASSET.valueOf()
    ));

    return (): any => destructors.map(fn => fn());
}
