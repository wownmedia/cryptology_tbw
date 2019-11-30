import { Interfaces } from "@arkecosystem/crypto";
import { Result } from "pg";
import BigNumber from "bignumber.js";
import {
    Block,
    DatabaseConfig,
    DelegateTransaction,
    ForgedBlock,
    Transaction,
    Voter,
    VoterBlock,
    VoterMutation,
} from "../interfaces";
import { logger, Postgres } from "../services";
import { Crypto } from "./crypto";
import {
    getDelegateTransactions,
    getForgedBlocks,
    getTransactions,
    getVoterSinceHeight,
    getVotingDelegates,
} from "./queries";

export class DatabaseAPI {
    /**
     * Convert to a Buffer and then deserialize a transaction
     * @param {string} transaction
     * @param {number} blockHeight
     * @static
     */
    private static deserializeTransaction(
        transaction: string,
        blockHeight: number
    ): Interfaces.ITransaction {
        try {
            const buffer: Buffer = Buffer.from(transaction, "hex");
            const serialized: string = Buffer.from(buffer).toString("hex");
            return Crypto.deserializeTransaction(serialized, blockHeight);
        } catch (error) {
            logger.error(`Deserialize transaction: ${error.message}`);
            return null;
        }
    }

    private readonly psql: Postgres;

    constructor(databaseConfig: DatabaseConfig) {
        this.psql = new Postgres(databaseConfig);
    }

    /**
     *
     * @param delegatePublicKey
     * @param startBlockHeight
     * @param historyAmountBlocks
     */
    public async getForgedBlocks(
        delegatePublicKey: string,
        startBlockHeight: number,
        historyAmountBlocks: number
    ): Promise<ForgedBlock[]> {
        await this.psql.connect();
        const getForgedBlocksQuery: string = getForgedBlocks(
            delegatePublicKey,
            startBlockHeight,
            historyAmountBlocks
        );
        const result: Result = await this.psql.query(getForgedBlocksQuery);
        await this.psql.close();

        if (result.rows.length === 0) {
            return [];
        }

        const forgedBlocks: ForgedBlock[] = result.rows.map((block: Block) => {
            return {
                height: new BigNumber(block.height).integerValue(),
                fees: new BigNumber(block.totalFee),
                timestamp: new BigNumber(block.timestamp).integerValue(),
            };
        });

        logger.info(
            `${JSON.stringify(forgedBlocks.length)} Forged blocks retrieved: (${
                forgedBlocks[forgedBlocks.length - 1].height
            } - ${forgedBlocks[0].height})`
        );
        return forgedBlocks;
    }

    /**
     *
     * @param delegatePublicKey
     * @param startBlockHeight
     * @param payoutSignature
     */
    public async getDelegatePayoutTransactions(
        delegatePublicKey: string,
        startBlockHeight: number,
        payoutSignature: string
    ): Promise<DelegateTransaction[]> {
        const getDelegateTransactionsQuery = getDelegateTransactions(
            startBlockHeight,
            delegatePublicKey
        );
        await this.psql.connect();
        const result: Result = await this.psql.query(
            getDelegateTransactionsQuery
        );
        await this.psql.close();

        if (result.rows.length === 0) {
            return [];
        }

        const delegatePayoutTransactions: DelegateTransaction[] = result.rows
            .map(transaction => {
                const data: Interfaces.ITransaction = DatabaseAPI.deserializeTransaction(
                    transaction.serialized,
                    startBlockHeight
                );

                logger.info(`DATA: ${JSON.stringify(data)} || DATA.DATA ${JSON.stringify(data.data)}`);
                return {
                    height: new BigNumber(transaction.height).integerValue(),
                    recipientId:
                         data.data.type === 0 ? data.data.recipientId : null,
                    multiPayment:
                        data.data.type === 6 ? data.data.asset.payments : null,
                    vendorField:
                        data && data.hasVendorField()
                            ? data.data.vendorField
                            : null,
                    timestamp: parseInt(transaction.timestamp, 10),
                };
            })
            .filter(transaction => {
                return (
                    transaction.vendorField &&
                    transaction.vendorField.includes(payoutSignature)
                );
            });
        logger.info(
            `${delegatePayoutTransactions.length} Delegate Payout Transactions retrieved.`
        );
        return delegatePayoutTransactions;
    }

    /**
     * @dev  Get all the votes/unvotes for this delegate that are within range.
     */
    public async getVoterMutations(
        delegatePublicKey: string,
        startBlockHeight: number
    ): Promise<VoterMutation[]> {
        const getVoterSinceHeightQuery = getVoterSinceHeight(startBlockHeight);
        await this.psql.connect();
        const result: Result = await this.psql.query(getVoterSinceHeightQuery);
        await this.psql.close();

        if (result.rows.length === 0) {
            return [];
        }

        return result.rows
            .map(transaction => {
                const data = DatabaseAPI.deserializeTransaction(
                    transaction.serialized,
                    startBlockHeight
                );
                return {
                    height: parseInt(transaction.height, 10),
                    address: transaction.recipient_id,
                    vote: data ? data.data.asset.votes[0] : "",
                };
            })
            .filter(transaction => {
                return transaction.vote.includes(`${delegatePublicKey}`);
            });
    }

    public async getVotingDelegateBlocks(
        voterWallets: Voter[],
        startBlockHeight: number
    ): Promise<VoterBlock[]> {
        const wallets: Map<string, string> = new Map(
            voterWallets.map(wallet => [wallet.publicKey, wallet.address])
        );
        const getVotingDelegatesQuery: string = getVotingDelegates(
            startBlockHeight
        );
        await this.psql.connect();
        const result: Result = await this.psql.query(getVotingDelegatesQuery);
        await this.psql.close();

        if (result.rows.length === 0) {
            return [];
        }

        const votingDelegateBlocks: VoterBlock[] = [];
        for (const item of result.rows) {
            if (
                item.hasOwnProperty("generator_public_key") &&
                wallets.has(item.generator_public_key)
            ) {
                const address: string = wallets.get(item.generator_public_key);
                const block: VoterBlock = {
                    address,
                    height: parseInt(item.height, 10),
                    fees: new BigNumber(item.total_fee),
                };
                votingDelegateBlocks.push(block);
            }
        }

        return votingDelegateBlocks;
    }

    public async getTransactions(
        voters: string[],
        votersPublicKeys: string[],
        startBlockHeight: number,
        networkVersion: number
    ): Promise<Transaction[]> {
        const getTransactionsQuery = getTransactions(
            voters,
            votersPublicKeys,
            startBlockHeight
        );

        await this.psql.connect();
        const result: Result = await this.psql.query(getTransactionsQuery);
        await this.psql.close();

        if (result.rows.length === 0) {
            return [];
        }

        const transactions: Transaction[] = result.rows.map(transaction => {
            const data = DatabaseAPI.deserializeTransaction(
                transaction.serialized,
                startBlockHeight
            );
            const senderId: string = Crypto.getAddressFromPublicKey(
                data.data.senderPublicKey,
                networkVersion
            );
            return {
                amount: data.data.amount,
                recipientId:
                    data.data.type === 0 ? data.data.recipientId : null,
                multiPayment:
                    data.data.type === 6 ? data.data.asset.payments : null,
                senderId,
                senderPublicKey: data.data.senderPublicKey,
                fee: data.data.fee,
                height: parseInt(transaction.height, 10),
                timestamp: parseInt(transaction.timestamp, 10),
            };
        });

        logger.info(`Transactions retrieved: ${transactions.length}`);
        return transactions;
    }
}
