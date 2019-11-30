import BigNumber from "bignumber.js";
import { ARKTOSHI } from "../constants";
import { Payouts } from "../interfaces";
import { Config, logger } from "../services";

export class ProposalEngine {
  private readonly config: Config;
  private readonly minimalPayoutArktoshiValue: BigNumber;

  constructor() {
    BigNumber.config({
      DECIMAL_PLACES: 8,
      ROUNDING_MODE: BigNumber.ROUND_DOWN
    });

    try {
      this.config = new Config();
      this.minimalPayoutArktoshiValue = this.config.minimalPayoutValue.times(
        ARKTOSHI
      );
    } catch (e) {
      logger.error(e.message);
      process.exit(1);
    }
  }

  // TODO typecasting
  public applyProposal(
    currentBlock,
    latestPayouts,
    smallWallets,
    payouts: Map<string, BigNumber>,
    feesPayouts: Map<string, BigNumber>
  ): Payouts {
    let totalPayout: BigNumber = new BigNumber(0);
    let delegateProfit: BigNumber = new BigNumber(0);
    let acfDonation: BigNumber = new BigNumber(0);

    for (const [address, balance] of payouts) {
      // TODO: OPTIMIZE THIS
      if (
        this.isFrequencyMinimumReached(address, currentBlock, latestPayouts)
      ) {
        // Percentages
        const percentage: BigNumber = this.getSharePercentage(
          address,
          smallWallets
        );
        const acfPayout: BigNumber = new BigNumber(balance).times(
          this.config.donationShare
        );
        const voterPayout: BigNumber = new BigNumber(balance).times(percentage);
        const delegatePayout: BigNumber = new BigNumber(balance)
          .minus(acfPayout)
          .minus(voterPayout);

        delegateProfit = delegateProfit.plus(delegatePayout);
        payouts.set(address, new BigNumber(voterPayout));
        acfDonation = acfDonation.plus(acfPayout);

        const feePayout: BigNumber = feesPayouts.get(address)
          ? new BigNumber(feesPayouts.get(address)).times(
              this.config.voterFeeShare
            )
          : new BigNumber(0);
        feesPayouts.set(address, feePayout);
        delegateProfit = delegateProfit.plus(
          feePayout.times(new BigNumber(1).minus(this.config.voterFeeShare))
        );

        const payout: BigNumber = new BigNumber(
          payouts.get(address).plus(feesPayouts.get(address))
        );
        payouts.set(address, payout);
        if (
          payouts.get(address).lt(this.minimalPayoutArktoshiValue) ||
          payouts.get(address).eq(0)
        ) {
          if (payouts.get(address).gt(0)) {
            logger.warn(
              `Payout to ${address} pending (min. value ${this.minimalPayoutArktoshiValue
                .div(ARKTOSHI)
                .toNumber()}): ${payouts
                .get(address)
                .div(ARKTOSHI)
                .toFixed(8)}`
            );
          }
          payouts.delete(address);
        } else {
          totalPayout = totalPayout.plus(payouts.get(address));
        }
      } else {
        payouts.delete(address);
      }
    }

    // FairFees
    const multiPaymentFees: BigNumber = new BigNumber(payouts.size)
      .div(this.config.transactionsPerMultitransfer)
      .integerValue(BigNumber.ROUND_CEIL)
      .times(this.config.multiTransferFee);
    const totalFees: BigNumber = this.config.transferFee
      .times(this.getAdminFeeCount() + this.getACFFeeCount())
      .plus(multiPaymentFees);
    for (const [address, balance] of payouts) {
      const fairFees: BigNumber = balance.div(totalPayout).times(totalFees);
      payouts.set(address, balance.minus(fairFees));
    }

    logger.info(
      "=================================================================================="
    );
    logger.info(
      `Next payout run: ${
        payouts.size
      } share payouts with total amount: ${totalPayout
        .div(ARKTOSHI)
        .toFixed(8)} including fees ${totalFees.div(ARKTOSHI).toFixed(8)}`
    );
    logger.info(`Delegate Profits: ${delegateProfit.div(ARKTOSHI).toFixed(8)}`);
    logger.info(`License Fee: ${acfDonation.div(ARKTOSHI).toFixed(8)}`);
    logger.info(
      "=================================================================================="
    );

    return { payouts, acfDonation, delegateProfit, timestamp: 0 };
  }

  /*
      Returns true if no custom frequency is set, the address hasn't yet received a disbursement,
      or the current block has now passed the custom minimum threshold. Returns false otherwise.
    */
  public isFrequencyMinimumReached(
    address: string,
    currentBlock: number,
    latestPayouts
  ): boolean {
    const frequency: number = this.getFrequencyAddress(address);
    const lastPayoutHeight = latestPayouts.get(address);

    if (!lastPayoutHeight || !frequency) {
      return true;
    }

    const blockMinimums: number = lastPayoutHeight + frequency;
    if (blockMinimums < currentBlock) {
      return true;
    }

    logger.warn(
      `Payout to ${address} pending (delay of ${frequency} blocks not yet reached) [${blockMinimums}/${currentBlock}]`
    );
    return false;
  }

  public getFrequencyAddress(address: string): number {
    if (
      this.config.customPayoutFrequencies.hasOwnProperty(address) === true &&
      typeof this.config.customPayoutFrequencies[address] === "number"
    ) {
      return this.config.customPayoutFrequencies[address];
    }
    return 0;
  }

  public getSharePercentage(address: string, smallWallets): BigNumber {
    if (this.config.customShares.hasOwnProperty(address) === true) {
      logger.info(
        `Custom share percentage found for ${address}: ${new BigNumber(
          this.config.customShares[address]
        )
          .times(100)
          .toString()}%`
      );
      const customShare: BigNumber = new BigNumber(
        this.config.customShares[address]
      );
      if (customShare.plus(this.config.donationShare).gt(1)) {
        logger.warn(
          `Custom share percentage for ${address} is larger than 100%: percentage has been capped at 100%`
        );
        return customShare.minus(this.config.donationShare);
      }
      if (customShare.lt(0)) {
        logger.warn(
          `Custom share percentage for ${address} is smaller than 0%: percentage has been capped at 0%`
        );
        return new BigNumber(0);
      }
      return customShare;
    }

    // check if maximum wallet balance for this voter is <= small wallet limit and then return small wallet share
    if (smallWallets.get(address) === true) {
      logger.warn(`Small Wallet: ${address} detected.`);
      return this.config.smallWalletBonus.percentage;
    }
    return this.config.voterShare;
  }

  public getAdminFeeCount(): number {
    const ADMIN_PAYOUT_LIST = process.env.ADMIN_PAYOUT_LIST
      ? JSON.parse(process.env.ADMIN_PAYOUT_LIST)
      : {};
    return Object.keys(ADMIN_PAYOUT_LIST).length;
  }

  public getACFFeeCount(): number {
    if (this.config.donationShare.gt(0)) {
      return 1;
    }
    return 0;
  }
}
