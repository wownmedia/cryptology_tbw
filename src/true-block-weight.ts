import {Payouts, Receiver} from "./interfaces";
import {Config, logger} from "./services";
import {TransactionEngine, TrueBlockWeightEngine} from "./utils";
import BigNumber from "bignumber.js";
import {ARKTOSHI} from "./constants";

export class TrueBlockWeight {

    private readonly config: Config;
    private transactionEngine: TransactionEngine;

    constructor() {
        this.config = new Config();
        this.transactionEngine = new TransactionEngine();
    }

    public async calculate(): Promise<Payouts> {
        const trueBlockWeightEngine = new TrueBlockWeightEngine();
        return await trueBlockWeightEngine.generatePayouts();
    }

    public async payout() {
        const payouts: Payouts = await this.calculate();
        const transactions = this.generateTransactions(payouts);
        // todo payout
    }

    public async check() {
        const payouts: Payouts = await this.calculate();
        const transactions = this.generateTransactions(payouts);
        // todo show transactions
    }

    private async generateTransactions(payouts: Payouts) {
        let totalAmount: BigNumber = new BigNumber(0);
        let totalFees: BigNumber = new BigNumber(0);

        const transactions = [];
        for (const [address] of payouts.payouts) {
            const wallet: string = this.getRedirectAddress(address);
            logger.info(
                `Payout to ${wallet} prepared: ${payouts.payouts
                    .get(address)
                    .div(ARKTOSHI)
                    .toFixed(8)}`
            );
            const amount: BigNumber = payouts.payouts.get(address);
            const vendorField: string = `${this.config.delegate} - ${this.config.vendorField}`;
            const receiver: Receiver = {
                amount,
                vendorField,
                wallet
            };
            const transaction = await this.transactionEngine.createTransaction(
                receiver,
                payouts.timestamp
            );
            totalAmount = totalAmount.plus(amount);
            totalFees = totalFees.plus(this.config.transferFee);
            transactions.push(transaction);
        }

        return { totalAmount, totalFees, transactions };
    }

    private getRedirectAddress(address: string): string {
        if (this.config.walletRedirections.hasOwnProperty(address) === true) {
            logger.info(
                `Redirection found for ${address}: ${this.config.walletRedirections[address]}`
            );
            return this.config.walletRedirections[address];
        }
        return address;
    }
}