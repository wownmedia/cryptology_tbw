import { Interfaces } from "@arkecosystem/crypto";
import BigNumber from "bignumber.js";
import { Result } from "pg";
import {
    Block,
    DatabaseConfig,
    DataBaseTransaction,
    DelegateTransaction,
    ForgedBlock,
    Transaction,
    Voter,
    VoterBlock,
    VoterMutation,
    VoteTransaction,
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
        const buffer: Buffer = Buffer.from(transaction, "hex");
        const serialized: string = Buffer.from(buffer).toString("hex");

        try {
            return Crypto.deserializeTransaction(serialized, blockHeight);
        } catch (error) {
            // Try to deserialize with a lower blockHeight
            try {
                return Crypto.deserializeTransaction(serialized, 1);
            } catch (error) {
                return Crypto.deserializeMagistrateTransaction(serialized);
            }
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
     * @param endBlockHeight
     * @param historyAmountBlocks
     */
    public async getForgedBlocks(
        delegatePublicKey: string,
        startBlockHeight: number,
        endBlockHeight: number,
        historyAmountBlocks: number
    ): Promise<ForgedBlock[]> {
        await this.psql.connect();
        const getForgedBlocksQuery: string = getForgedBlocks(
            delegatePublicKey,
            startBlockHeight,
            endBlockHeight,
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
                fees: new BigNumber(block.totalFee).minus(
                    new BigNumber(block.removedFee)
                ),
                timestamp: new BigNumber(block.timestamp),
                business: new BigNumber(0),
                reward: new BigNumber(block.reward),
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
     * @param endBlockHeight
     * @param payoutSignature
     * @param noSignature In case a Blockchain doesn't use a VendorField (e.g. like NOS)
     */
    public async getDelegatePayoutTransactions(
        delegatePublicKey: string,
        startBlockHeight: number,
        endBlockHeight: number,
        payoutSignature: string,
        noSignature: boolean
    ): Promise<DelegateTransaction[]> {
        const getDelegateTransactionsQuery = getDelegateTransactions(
            startBlockHeight,
            endBlockHeight,
            delegatePublicKey
        );
        await this.psql.connect();
        const result: Result = await this.psql.query(
            getDelegateTransactionsQuery
        );
        await this.psql.close();

        if (result.rows.length === 0) {
            logger.info("No Delegate payouts retrieved.");
            return [];
        }

        const delegatePayoutTransactions: DelegateTransaction[] = result.rows
            .map((transaction: DataBaseTransaction) => {
                const data: Interfaces.ITransaction = DatabaseAPI.deserializeTransaction(
                    transaction.serialized,
                    transaction.height
                );

                if (data !== null) {
                    return {
                        amount: new BigNumber(transaction.amount),
                        height: new BigNumber(
                            transaction.height
                        ).integerValue(),
                        recipientId:
                            data.data.type === 0 ? data.data.recipientId : null,
                        multiPayment:
                            data.data.type === 6
                                ? data.data.asset.payments
                                : null,
                        vendorField:
                            data && data.hasVendorField()
                                ? data.data.vendorField
                                : "",
                        timestamp: new BigNumber(transaction.timestamp),
                    };
                }
                return {};
            })
            .filter((transaction: DelegateTransaction) => {
                return (
                    noSignature ||
                    (transaction.vendorField &&
                        transaction.vendorField.includes(payoutSignature))
                );
            });
        logger.info(
            `${delegatePayoutTransactions.length} Delegate Payout Transactions retrieved.`
        );
        return delegatePayoutTransactions;
    }

    /**
     * Get all the votes/unvotes for this delegate that are within range.
     * @param delegatePublicKey
     * @param startBlockHeight
     * @param endBlockHeight
     * @param networkVersion
     */
    public async getVoterMutations(
        delegatePublicKey: string,
        startBlockHeight: number,
        endBlockHeight: number,
        networkVersion: number
    ): Promise<VoterMutation[]> {
        const getVoterSinceHeightQuery: string = getVoterSinceHeight(
            startBlockHeight,
            endBlockHeight
        );
        await this.psql.connect();
        const result: Result = await this.psql.query(getVoterSinceHeightQuery);
        await this.psql.close();

        if (result.rows.length === 0) {
            logger.info("0 Voter mutations retrieved.");
            return [];
        }

        try {
            const voterMutations: VoterMutation[] = result.rows
                .map((transaction: VoteTransaction) => {
                    const data: Interfaces.ITransaction = DatabaseAPI.deserializeTransaction(
                        transaction.serialized,
                        transaction.height
                    );

                    if (data !== null) {
                        const address: string = Crypto.getAddressFromPublicKey(
                            data.data.senderPublicKey,
                            networkVersion
                        );
                        return {
                            height: new BigNumber(
                                transaction.height
                            ).integerValue(),
                            address,
                            vote: data.data.asset.votes[0],
                        };
                    }
                    return {};
                })
                .filter((transaction: VoterMutation) => {
                    return (
                        transaction.vote &&
                        transaction.vote.includes(`${delegatePublicKey}`)
                    );
                });

            logger.info(`${voterMutations.length} Voter mutations retrieved.`);
            for (const vote in voterMutations) {
                if (voterMutations[vote]) {
                    const votingTransaction: VoterMutation =
                        voterMutations[vote];
                    const voterAction = votingTransaction.vote.startsWith("+")
                        ? "voted"
                        : "unvoted";
                    logger.info(
                        `Vote: ${votingTransaction.address} ${voterAction} at blockHeight ${votingTransaction.height}`
                    );
                }
            }
            return voterMutations;
        } catch (e) {
            logger.info("0 Voter mutations retrieved.");
            return [];
        }
    }

    /**
     *
     * @param voterWallets
     * @param startBlockHeight
     * @param endBlockHeight
     */
    public async getVotingDelegateBlocks(
        voterWallets: Voter[],
        startBlockHeight: number,
        endBlockHeight: number
    ): Promise<VoterBlock[]> {
        const wallets: Map<string, string> = new Map(
            voterWallets.map((wallet) => [wallet.publicKey, wallet.address])
        );
        const getVotingDelegatesQuery: string = getVotingDelegates(
            startBlockHeight,
            endBlockHeight
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

    /**
     *
     * @param voters
     * @param votersPublicKeys
     * @param startBlockHeight
     * @param endBlockHeight
     * @param networkVersion
     */
    public async getTransactions(
        voters: string[],
        votersPublicKeys: string[],
        startBlockHeight: number,
        endBlockHeight: number,
        networkVersion: number
    ): Promise<Transaction[]> {
        const getTransactionsQuery = getTransactions(
            voters,
            votersPublicKeys,
            startBlockHeight,
            endBlockHeight
        );

        await this.psql.connect();
        const result: Result = await this.psql.query(getTransactionsQuery);
        await this.psql.close();

        if (result.rows.length === 0) {
            return [];
        }

        //todo remove
        //for (const item in result.rows) {
        //    logger.info(`${item}: ${JSON.stringify(result.rows[item])}`)
        //}
        const transactions: Transaction[] = result.rows.map(
            (transaction: DataBaseTransaction) => {
                const data = DatabaseAPI.deserializeTransaction(
                    transaction.serialized,
                    transaction.height
                );

                //if (data === null) {
                    logger.warn(`data null at ${transaction.height} for ${transaction.senderPublicKey} || ${data.data.senderPublicKey}`);
                //}
                if (data !== null) {
                    const senderId: string = Crypto.getAddressFromPublicKey(
                        transaction.senderPublicKey,
                        networkVersion
                    );

                    //todo remove
                    if(senderId === "cmcsmGe18ngpEo35oGCdBKJ2ziguQSWNYG" || transaction.recipientId === "cmcsmGe18ngpEo35oGCdBKJ2ziguQSWNYG") {
                        logger.info(`transaction at ${transaction.height}: ${senderId} -> amount: ${transaction.amount} || ${transaction.recipientId}: ${JSON.stringify(data)}`)
                    }

                    return {
                        amount: transaction.amount,
                        recipientId:
                            data.data.type === 0 ? transaction.recipientId : null,
                        multiPayment:
                            data.data.type === 6
                                ? data.data.asset && data.data.asset.payments
                                : null,
                        senderId,
                        senderPublicKey: transaction.senderPublicKey,
                        fee: new BigNumber(transaction.fee),
                        height: new BigNumber(
                            transaction.height
                        ).integerValue(),
                        timestamp: new BigNumber(transaction.timestamp),
                        stakeRedeem:
                            data.data.asset &&
                            data.data.asset.hasOwnProperty("stakeRedeem") &&
                            data.data.asset.stakeRedeem.hasOwnProperty("id")
                                ? data.data.asset.stakeRedeem.id
                                : null,
                    };
                }
                return {};
            }
        );

        logger.info(`${transactions.length} Transactions retrieved.`);
        return transactions;
    }
}
