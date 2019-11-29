import { Payouts, Receiver } from "./interfaces";
import { Config, logger } from "./services";
import { TransactionEngine, TrueBlockWeightEngine } from "./utils";
import BigNumber from "bignumber.js";
import { ARKTOSHI } from "./constants";

export class TrueBlockWeight {
  private readonly config: Config;
  private transactionEngine: TransactionEngine;

  constructor() {
    this.config = new Config();
    this.transactionEngine = new TransactionEngine();
  }

  public async calculate(): Promise<any> {
    const trueBlockWeightEngine = new TrueBlockWeightEngine();
    const payouts: Payouts = await trueBlockWeightEngine.generatePayouts();
    const transfers = await this.generateTransactions(payouts);
    const adminTransactions = await this.generateAdminPayouts(
      payouts.delegateProfit,
      payouts.timestamp
    );
    if (adminTransactions.length) {
      transfers.totalAmount = transfers.totalAmount.plus(
        payouts.delegateProfit.toFixed(0)
      );
      transfers.totalFees = transfers.totalFees.plus(
        this.config.transferFee.times(adminTransactions.length)
      );
      transfers.transactions = transfers.transactions.concat(adminTransactions);
    }

    const acfDonationTransaction = await this.generateDonationPayout(
      payouts.acfDonation,
      payouts.timestamp
    );
    if (acfDonationTransaction !== null) {
      transfers.transactions.push(acfDonationTransaction);
      transfers.totalAmount = transfers.totalAmount.plus(
        payouts.acfDonation.toFixed(0)
      );
      transfers.totalFees = transfers.totalFees.plus(this.config.transferFee);
    }

      logger.info(
          "=================================================================================="
      );
      logger.info(
          `Ready to Payout: ${transfers.totalAmount
              .div(ARKTOSHI)
              .toFixed(8)} + ${transfers.totalFees.div(ARKTOSHI).toFixed(8)} fees.`
      );
      logger.info(
          "=================================================================================="
      );
    return transfers;
  }

  public async payout() {
    const transfers = await this.calculate();
    // todo payout
  }

  public async check() {
    const transfers = await this.calculate();
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

  private async generateAdminPayouts(
    totalAmount: BigNumber,
    timestamp: number
  ) {
    let payoutAmount: BigNumber = new BigNumber(0);
    let adminTransactions = [];
    for (let admin of this.config.admins) {
      const amount: BigNumber = totalAmount.times(admin.percentage);
      const vendorField = `${this.config.delegate} - ${admin.vendorField}`;
      const receiver: Receiver = {
        amount,
        vendorField,
        wallet: admin.wallet
      };
      const transaction = await this.transactionEngine.createTransaction(
        receiver,
        timestamp
      );
      adminTransactions.push(transaction);
      payoutAmount = payoutAmount.plus(amount);
    }

    if (payoutAmount.gt(totalAmount)) {
      logger.error("Check admin payout percentages!");
      return [];
    }

    for (let item in adminTransactions) {
      const admin = adminTransactions[item].recipientId;
      const amount = new BigNumber(adminTransactions[item].amount);
      logger.info(
        `Administrative Payout to ${admin} prepared: ${amount
          .div(ARKTOSHI)
          .toFixed(8)}`
      );
    }
    return adminTransactions;
  }

  private async generateDonationPayout(
    amount: BigNumber,
    timestamp: number
  ): Promise<any> {
    if (amount.isNaN() || amount.lte(0)) {
      return null;
    }
    logger.info(
      `License fee Payout to prepared: ${amount.div(ARKTOSHI).toFixed(8)}`
    );
    const vendorField = `${this.config.delegate} - ${this.config.vendorFieldDonation}`;
    const receiver: Receiver = {
      amount,
      vendorField,
      wallet: this.config.licenseWallet
    };
    return await this.transactionEngine.createTransaction(receiver, timestamp);
  }
}
