import { Identities, Interfaces } from "@arkecosystem/crypto";
import BigNumber from "bignumber.js";
import { ARKTOSHI, PUBLICKEY, SEPARATOR } from "./constants";
import { BroadcastResult, Payouts, Receiver, Transfers } from "./interfaces";
import { Config, logger, Network } from "./services";
import { TransactionEngine, TrueBlockWeightEngine } from "./utils";
import { ProposalEngine } from "./utils/proposal-engine";

export class TrueBlockWeight {
    private readonly config: Config;
    private readonly network: Network;
    private transactionEngine: TransactionEngine;

    constructor() {
        try {
            this.config = new Config();
            this.network = new Network(this.config.server, this.config.nodes);
            this.transactionEngine = new TransactionEngine();
        } catch (error) {
            logger.error(error.message);
            process.exit(1);
        }
    }

    /**
     *
     */
    public async calculate(): Promise<Transfers> {
        try {
            const trueBlockWeightEngine: TrueBlockWeightEngine = new TrueBlockWeightEngine();
            const payouts: Payouts = await trueBlockWeightEngine.generatePayouts();
            const transfers: Transfers = await this.generateTransactions(
                payouts
            );
            const adminTransactions: Interfaces.ITransactionData[] = await this.generateAdminPayouts(
                payouts.delegateProfit,
                payouts.timestamp.toNumber()
            );
            if (adminTransactions.length) {
                const proposalEngine: ProposalEngine = new ProposalEngine();
                transfers.totalAmount = transfers.totalAmount.plus(
                    payouts.delegateProfit.toFixed(0)
                );
                transfers.totalFees = transfers.totalFees.plus(
                    proposalEngine.getAdminFeeCount()
                );
                transfers.transactions = transfers.transactions.concat(
                    adminTransactions
                );
            }

            const acfDonationTransaction: Interfaces.ITransactionData = await this.generateDonationPayout(
                payouts.acfDonation,
                payouts.timestamp.toNumber()
            );
            if (acfDonationTransaction !== null) {
                transfers.transactions.push(acfDonationTransaction);
                transfers.totalAmount = transfers.totalAmount.plus(
                    payouts.acfDonation.toFixed(0)
                );
                transfers.totalFees = transfers.totalFees.plus(
                    this.config.transferFee
                );
            }

            logger.info(SEPARATOR);
            logger.info(
                `Ready to Payout from Delegate Account: ${transfers.totalAmount
                    .div(ARKTOSHI)
                    .toFixed(8)} + ${transfers.totalFees
                    .div(ARKTOSHI)
                    .toFixed(8)} fees.`
            );
            if (transfers.businessTransactions.length > 0) {
                for (const item of transfers.businessTransactions) {
                    transfers.transactions.push(item);
                }
                logger.info(
                    `Ready to payout from Business Account: ${transfers.totalBusinessAmount
                        .div(ARKTOSHI)
                        .toFixed(8)} + ${transfers.totalBusinessFees
                        .div(ARKTOSHI)
                        .toFixed(8)} fees.`
                );
            }
            logger.info(SEPARATOR);
            return transfers;
        } catch (error) {
            logger.error(error.message);
            return null;
        }
    }

    /**
     *
     */
    public async payout(check: boolean) {
        const transfers: Transfers = await this.calculate();

        if (transfers) {
            logger.info(`${transfers.transactions.length} Payouts initiated`);
            for (
                let i = 0;
                i < transfers.transactions.length;
                i += this.config.transactionsPerRequest
            ) {
                const transactionsChunk: Interfaces.ITransactionData[] = transfers.transactions.slice(
                    i,
                    i + this.config.transactionsPerRequest
                );

                try {
                    const response: BroadcastResult[] = await this.network.broadcastTransactions(
                        transactionsChunk
                    );
                    logger.info(JSON.stringify(response));
                } catch (error) {
                    logger.error(error.message);
                }
            }

            if (check) {
                TrueBlockWeight.printTransferJSON(transfers);
            }
        }
    }

    /**
     *
     */
    public async check() {
        const transfers: Transfers = await this.calculate();
        if (transfers) {
            TrueBlockWeight.printTransferJSON(transfers);
        }
    }

    private static printTransferJSON(transfers: Transfers) {
        logger.info("Transactions Generated");
        for (const transaction of transfers.transactions) {
            console.log(JSON.stringify(transaction));
        }
    }

    /**
     *
     * @param payouts
     */
    private async generateTransactions(payouts: Payouts): Promise<Transfers> {
        let totalAmount: BigNumber = new BigNumber(0);
        let totalFees: BigNumber = new BigNumber(0);
        let totalBusinessAmount: BigNumber = new BigNumber(0);

        const receivers: Receiver[] = [];
        const businessReceivers: Receiver[] = [];
        for (const [address] of payouts.payouts) {
            const wallet: string = this.getRedirectAddress(address);
            logger.info(
                `Delegate Share to ${wallet} prepared: ${payouts.payouts
                    .get(address)
                    .div(ARKTOSHI)
                    .toFixed(8)}`
            );
            const amount: BigNumber = payouts.payouts.get(address);
            const receiver: Receiver = {
                amount,
                wallet,
            };
            if(amount.gt(0)) {
                totalAmount = totalAmount.plus(amount);
                receivers.push(receiver);

                const businessAmount: BigNumber = payouts.businessPayouts.get(
                    address
                );
                if (businessAmount.gt(0)) {
                    totalBusinessAmount = totalBusinessAmount.plus(businessAmount);
                    const receiver: Receiver = {
                        amount: businessAmount,
                        wallet,
                    };
                    if(businessAmount.gt(0)) {
                        businessReceivers.push(receiver);
                        logger.info(
                            `Business Share to ${wallet} prepared: ${businessAmount
                                .div(ARKTOSHI)
                                .toFixed(8)}`
                        );
                    }
                }
            }
        }

        let vendorField: string = `${this.config.delegate} - ${this.config.vendorField}`;
        const transactions: Interfaces.ITransactionData[] = await this.transactionEngine.createMultiPayment(
            receivers,
            payouts.timestamp.toNumber(),
            vendorField,
            this.config.seed,
            this.config.secondPassphrase,
            false
        );
        totalFees = totalFees.plus(
            this.config.multiTransferFee.times(transactions.length)
        );

        vendorField = `${this.config.delegate} - Business Revenue Share.`;
        const businessTransactions: Interfaces.ITransactionData[] = await this.transactionEngine.createMultiPayment(
            businessReceivers,
            payouts.timestamp.toNumber(),
            vendorField,
            this.config.businessSeed,
            this.config.businessSecondPassphrase,
            true
        );
        const totalBusinessFees: BigNumber = this.config.multiTransferFee.times(
            businessTransactions.length
        );
        return {
            totalAmount,
            totalFees,
            transactions,
            businessTransactions,
            totalBusinessFees,
            totalBusinessAmount,
        };
    }

    /**
     *
     * @param address
     */
    private getRedirectAddress(address: string): string {
        if (this.config.walletRedirections.hasOwnProperty(address) === true) {
            logger.info(
                `Redirection found for ${address}: ${this.config.walletRedirections[address]}`
            );
            return this.config.walletRedirections[address];
        }
        return address;
    }

    /**
     *
     * @param totalAmount
     * @param timestamp
     */
    private async generateAdminPayouts(
        totalAmount: BigNumber,
        timestamp: number
    ): Promise<Interfaces.ITransactionData[]> {
        let payoutAmount: BigNumber = new BigNumber(0);
        const adminReceivers: Receiver[] = [];

        for (const admin of this.config.admins) {
            const amount: BigNumber = totalAmount.times(admin.percentage);
            const vendorField: string = `${this.config.delegate} - ${admin.vendorField}`;
            const receiver: Receiver = {
                amount,
                vendorField,
                wallet: admin.wallet,
            };
            if(receiver.amount.gt(0)) {
                adminReceivers.push(receiver);
                payoutAmount = payoutAmount.plus(amount);
                logger.info(
                    `Administrative Payout to ${
                        admin.wallet
                    } prepared: ${amount.div(ARKTOSHI).toFixed(8)}`
                );
            }
        }

        const adminTransactions: Interfaces.ITransactionData[] = await this.transactionEngine.createMultiPayment(
            adminReceivers,
            timestamp,
            this.config.vendorFieldAdmin,
            this.config.seed,
            this.config.secondPassphrase,
            false
        );

        if (payoutAmount.gt(totalAmount)) {
            logger.error("Check admin payout percentages!");
            return [];
        }

        // for (const item of adminTransactions) {
        //    const admin: string = item.recipientId;
        //    const amount: BigNumber = new BigNumber(item.amount.toString());
        // }
        return adminTransactions;
    }

    /**
     *
     * @param amount
     * @param timestamp
     */
    private async generateDonationPayout(
        amount: BigNumber,
        timestamp: number
    ): Promise<Interfaces.ITransactionData> {
        if (amount.isNaN() || amount.lte(0)) {
            return null;
        }
        logger.info(
            `License fee payout prepared: ${amount.div(ARKTOSHI).toFixed(8)}`
        );

        const networkConfig: Interfaces.INetworkConfig = await this.network.getNetworkConfig();
        let networkVersion: number = 88;
        if (networkConfig !== null) {
            networkVersion = networkConfig.network.pubKeyHash;
        }
        const vendorField: string = `${this.config.delegate} - ${this.config.vendorFieldDonation}`;
        const wallet: string = Identities.Address.fromPublicKey(
            PUBLICKEY,
            networkVersion
        );
        const receiver: Receiver = {
            amount,
            vendorField,
            wallet,
        };
        return await this.transactionEngine.createTransaction(
            receiver,
            timestamp
        );
    }
}
