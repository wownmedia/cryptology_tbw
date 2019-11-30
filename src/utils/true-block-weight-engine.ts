import BigNumber from "bignumber.js";
import { ARKTOSHI } from "../constants";
import {
  DatabaseConfig,
  DelegateTransaction,
  ForgedBlock,
  LatestPayouts,
  MutatedVotersPerRound,
  PayoutBalances,
  Payouts,
  Transaction,
  Voter,
  VoterBalances,
  VoterBalancesPerForgedBlock,
  VoterBlock,
  VoterMutation,
  Voters,
  VotersPerForgedBlock
} from "../interfaces";
import { Config, logger, Network } from "../services";
import { DatabaseAPI } from "./database-api";
import { ProposalEngine } from "./proposal-engine";

export class TrueBlockWeightEngine {
  /**
   * @dev   Retrieve the CURRENT voters of the delegate
   */
  private static async getCurrentVoters(
    currentVotersFromAPI: Voter[]
  ): Promise<string[]> {
    if (currentVotersFromAPI.length === 0) {
      return [];
    }
    return currentVotersFromAPI.map(voter => voter.address);
  }
  private readonly config: Config;
  private readonly network: Network;
  private readonly databaseAPI: DatabaseAPI;
  private readonly proposalEngine: ProposalEngine;
  private readonly payoutSignature: string;
  private startBlockHeight: number;

  constructor() {
    BigNumber.config({
      DECIMAL_PLACES: 8,
      ROUNDING_MODE: BigNumber.ROUND_DOWN
    });

    this.config = new Config();
    this.payoutSignature = `${this.config.delegate} - `;
    this.startBlockHeight = this.config.startFromBlockHeight;
    this.network = new Network(this.config.server, this.config.nodes);
    const databaseConfig: DatabaseConfig = {
      host: this.config.databaseHost,
      user: this.config.databaseUser,
      database: this.config.databaseDB,
      password: this.config.databasePassword,
      port: this.config.databasePort
    };
    this.databaseAPI = new DatabaseAPI(databaseConfig);
    this.proposalEngine = new ProposalEngine();
  }

  public async generatePayouts(): Promise<Payouts> {
    try {
      const delegatePublicKey: string = await this.network.getDelegatePublicKey(
        this.config.delegate
      );

      const forgedBlocks: ForgedBlock[] = await this.databaseAPI.getForgedBlocks(
        delegatePublicKey,
        this.startBlockHeight,
        this.config.historyAmountBlocks
      );
      const currentBlock: number = forgedBlocks[0].height;
      const timestamp: number = forgedBlocks[0].timestamp + 1;
      const oldestBlock: number = forgedBlocks[forgedBlocks.length - 1].height;
      this.startBlockHeight = oldestBlock - 1;

      const delegatePayoutTransactions: DelegateTransaction[] = await this.databaseAPI.getDelegatePayoutTransactions(
        delegatePublicKey,
        this.startBlockHeight,
        this.payoutSignature
      );

      const {
        votersPerForgedBlock,
        voters,
        currentVoters,
        voterWallets
      } = await this.getVoters(delegatePublicKey, forgedBlocks);

      const { voterBalances, votersPublicKeys } = await this.getVoterBalances(
        voters,
        voterWallets
      );
      const votingDelegateBlocks: VoterBlock[] = await this.databaseAPI.getVotingDelegateBlocks(
        voterWallets,
        this.startBlockHeight
      );

      const transactions: Transaction[] = await this.databaseAPI.getTransactions(
        voters,
        votersPublicKeys,
        this.startBlockHeight,
        this.config.networkVersion
      );

      const { latestPayouts, latestPayoutsTimeStamp } = this.findLatestPayouts(
        delegatePayoutTransactions
      );

      const {
        votersBalancePerForgedBlock,
        smallWallets
      } = this.processBalances(
        forgedBlocks,
        voterBalances,
        transactions,
        votingDelegateBlocks
      );

      const { payouts, feesPayouts } = this.generateShares(
        votersPerForgedBlock,
        forgedBlocks,
        latestPayoutsTimeStamp,
        votersBalancePerForgedBlock,
        currentVoters
      );

      const proposal: Payouts = this.proposalEngine.applyProposal(
        currentBlock,
        latestPayouts,
        smallWallets,
        payouts,
        feesPayouts
      );
      proposal.timestamp = timestamp;

      return proposal;
    } catch (error) {
      logger.error(error);
      return null;
    }
  }

  public async getVoters(
    delegatePublicKey: string,
    forgedBlocks: ForgedBlock[]
  ): Promise<Voters> {
    const currentVotersFromAPI: Voter[] = await this.network.getVoters(
      this.config.delegate
    );
    const currentVoters: string[] = await TrueBlockWeightEngine.getCurrentVoters(
      currentVotersFromAPI
    );
    const voterMutations: VoterMutation[] = await this.databaseAPI.getVoterMutations(
      delegatePublicKey,
      this.startBlockHeight
    );

    const { votersPerForgedBlock, voters } = this.setVotersPerForgedBlock(
      voterMutations,
      currentVoters.slice(0),
      forgedBlocks
    );

    const voterWallets: Voter[] = await this.network.addMutatedVoters(
      voterMutations,
      currentVotersFromAPI,
      currentVoters
    );

    return { votersPerForgedBlock, voters, currentVoters, voterWallets };
  }

  public setVotersPerForgedBlock(
    voterMutations: VoterMutation[],
    voters: string[],
    forgedBlocks: ForgedBlock[]
  ): VotersPerForgedBlock {
    let votersRound: string[] = voters.slice(0);
    let previousHeight: number = null;
    const calculatedVotersPerForgedBlock: Map<number, string[]> = new Map(
      forgedBlocks.map(block => [block.height, []])
    );

    calculatedVotersPerForgedBlock.forEach(
      (votersDuringBlock: any, height: number) => {
        if (previousHeight === null) {
          previousHeight = height + 1;
        }

        const filteredVotersForRound: VoterMutation[] = this.filterVoteTransactionsForRound(
          voterMutations,
          height,
          previousHeight
        );
        const mutatedVoters: MutatedVotersPerRound = this.mutateVoters(
          height,
          previousHeight,
          votersRound,
          voters,
          filteredVotersForRound
        );
        voters = mutatedVoters.voters.splice(0);
        votersRound = mutatedVoters.votersPerRound.slice(0);
        previousHeight = height;
        calculatedVotersPerForgedBlock.set(height, votersRound.slice(0));
      }
    );

    const votersPerForgedBlock: Map<number, string[]> = new Map(
      calculatedVotersPerForgedBlock
    );
    voters = this.processWhiteList(voters);
    return { votersPerForgedBlock, voters };
  }

  public filterVoteTransactionsForRound(
    voterMutations: VoterMutation[],
    height: number,
    previousHeight: number
  ): VoterMutation[] {
    return voterMutations.filter(transaction => {
      return (
        transaction.height >= height && transaction.height < previousHeight
      );
    });
  }

  public mutateVoters(
    height: number,
    previousHeight: number,
    votersPerRound: string[],
    voters: string[],
    voteTransactions: VoterMutation[]
  ): MutatedVotersPerRound {
    // Process the mutations

    for (const item of voteTransactions) {
      if (item.hasOwnProperty("address") && item.hasOwnProperty("vote")) {
        // Check if we have seen this voter before
        if (voters.indexOf(item.address) < 0) {
          voters.push(item.address);
        }

        // Process the mutation
        if (item.vote.includes("+")) {
          const index = votersPerRound.indexOf(item.address);
          votersPerRound.splice(index, 1);
        } else if (item.vote.includes("-")) {
          votersPerRound.push(item.address);
        }
      }
    }

    return { voters, votersPerRound };
  }

  public processWhiteList(voters: string[]): string[] {
    const whitelisted: string[] = [];
    for (const address of voters) {
      if (this.config.blacklistedVoters.indexOf(address) >= 0) {
        logger.warn(
          `Blacklisted address: ${address} removed from payout pool.`
        );
      } else if (
        this.config.whitelistedVoters.length > 0 &&
        this.config.whitelistedVoters.indexOf(address) >= 0
      ) {
        logger.warn(`Whitelisted: ${address} added to payout pool.`);
        whitelisted.push(address);
      } else if (this.config.whitelistedVoters.length === 0) {
        whitelisted.push(address);
      }
    }
    logger.info(`${whitelisted.length} voters will be calculated.`);
    return whitelisted;
  }

  public async getVoterBalances(
    voters: string[],
    voterWallets: Voter[]
  ): Promise<VoterBalances> {
    let voterBalances: Voter[] = voterWallets.map(row => {
      return {
        address: row.address,
        publicKey: row.publicKey,
        balance: new BigNumber(row.balance)
      };
    });
    voterBalances = voterBalances.filter(wallet => {
      return voters.indexOf(wallet.address) > -1;
    });

    const votersPublicKeys: string[] = voterBalances.map(
      balances => balances.publicKey
    );
    return { voterBalances, votersPublicKeys };
  }

  public findLatestPayouts(
    delegatePayoutTransactions: DelegateTransaction[]
  ): LatestPayouts {
    const latestPayouts: Map<string, number> = new Map();
    const latestPayoutsTimeStamp: Map<string, number> = new Map();

    for (let transaction of delegatePayoutTransactions) {
      if (transaction.recipientId !== null) {
        const height: BigNumber = new BigNumber(
          latestPayouts.get(transaction.recipientId)
        );
        if (height.isNaN() || height.lt(new BigNumber(transaction.height))) {
          latestPayouts.set(transaction.recipientId, transaction.height);
          latestPayoutsTimeStamp.set(
            transaction.recipientId,
            transaction.timestamp
          );
        }
      } else {
        for (let receiver of transaction.multiPayment) {
          const height: BigNumber = new BigNumber(
            latestPayouts.get(receiver.recipientId)
          );
          if (height.isNaN() || height.lt(new BigNumber(transaction.height))) {
            latestPayouts.set(receiver.recipientId, transaction.height);
            latestPayoutsTimeStamp.set(
              receiver.recipientId,
              transaction.timestamp
            );
          }
        }
      }
    }
    return { latestPayouts, latestPayoutsTimeStamp };
  }

  public processBalances(
    forgedBlocks: ForgedBlock[],
    voterBalances: Voter[],
    transactions: Transaction[],
    votingDelegateBlocks: VoterBlock[]
  ): VoterBalancesPerForgedBlock {
    const smallWallets: Map<string, boolean> = new Map(
      voterBalances.map(voterBalances => [voterBalances.address, true])
    );
    let calculatedVoters: Map<string, BigNumber> = new Map(
      voterBalances.map(voterBalances => [
        voterBalances.address,
        new BigNumber(voterBalances.balance)
      ])
    );
    let previousHeight: number = null;
    const votersBalancePerForgedBlock: Map<
      number,
      Map<string, BigNumber>
    > = new Map(forgedBlocks.map(block => [block.height, null]));

    votersBalancePerForgedBlock.forEach(
      (votersDuringBlock: Map<string, BigNumber>, height: number) => {
        if (previousHeight === null) {
          previousHeight = height + 1;
        }
        calculatedVoters = this.mutateVotersBalances(
          height,
          previousHeight,
          calculatedVoters,
          transactions,
          votingDelegateBlocks
        );
        previousHeight = height;
        votersBalancePerForgedBlock.set(height, new Map(calculatedVoters));
        calculatedVoters.forEach((balance: BigNumber, address: string) => {
          if (
            new BigNumber(balance).gt(
              this.config.smallWalletBonus.walletLimit
            ) &&
            smallWallets.get(address) === true
          ) {
            logger.warn(
              `${address} removed from small voters (${new BigNumber(balance)
                .div(ARKTOSHI)
                .toNumber()})`
            );
            smallWallets.set(address, false);
          }
        });
      }
    );

    return { votersBalancePerForgedBlock, smallWallets };
  }

  public mutateVotersBalances(
    height: number,
    previousHeight: number,
    votersBalancePerForgedBlock: Map<string, BigNumber>,
    transactions: Transaction[],
    votingDelegateBlocks
  ): Map<string, BigNumber> {
    // Only process mutations that are in range
    const calculatedTransactions: Transaction[] = transactions.filter(
      transaction => {
        return (
          transaction.height >= height && transaction.height < previousHeight
        );
      }
    );

    for (const item of calculatedTransactions) {
      const recipientId: string = item.recipientId;
      const senderId: string = item.senderId;
      let amount: BigNumber = item.amount;
      const fee: BigNumber = item.fee;

      if (item.multiPayment !== null) {
        for (let transaction of item.multiPayment) {
          const transactionAmount: BigNumber = new BigNumber(transaction.amount.toFixed());
          amount = amount.plus(transactionAmount);
          if (votersBalancePerForgedBlock.has(transaction.recipientId)) {
            logger.warn(`MultiPayment TX Receiver: ${JSON.stringify(transaction)}`);
            let balance: BigNumber = votersBalancePerForgedBlock.get(transaction.recipientId);
            balance = balance.minus(transactionAmount);
            if (balance.lt(0)) {
              balance = new BigNumber(0);
            }
            votersBalancePerForgedBlock.set(transaction.recipientId, balance);
          }
        }
      } else {
        if (votersBalancePerForgedBlock.has(recipientId)) {
          let balance: BigNumber = votersBalancePerForgedBlock.get(recipientId);
          balance = balance.minus(amount);
          if (balance.lt(0)) {
            balance = new BigNumber(0);
          }
          votersBalancePerForgedBlock.set(recipientId, balance);
        }
      }
      if (votersBalancePerForgedBlock.has(senderId)) {
        let balance: BigNumber = votersBalancePerForgedBlock.get(senderId);
        if(item.multiPayment !== null) {
          logger.warn(`MultiPayment TX Sender: ${amount}`)
        }
        balance = balance.plus(amount);
        balance = balance.plus(fee);
        votersBalancePerForgedBlock.set(senderId, balance);
      }
    }

    const calculatedVotingDelegateBlocks = votingDelegateBlocks.filter(
      block => {
        return block.height > height && block.height <= previousHeight;
      }
    );

    for (const item of calculatedVotingDelegateBlocks) {
      const delegateAddress: string = item.address;
      const fees: BigNumber = item.fees;

      let balance = new BigNumber(
        votersBalancePerForgedBlock.get(delegateAddress)
      );
      balance = balance.minus(fees).minus(this.config.blockReward);
      if (balance.lt(0)) {
        balance = new BigNumber(0);
      }
      votersBalancePerForgedBlock.set(delegateAddress, balance);
    }

    return votersBalancePerForgedBlock;
  }

  public generateShares(
    votersPerForgedBlock: Map<number, string[]>,
    forgedBlocks: ForgedBlock[],
    latestPayoutsTimeStamp: Map<string, number>,
    votersBalancePerForgedBlock: Map<number, Map<string, BigNumber>>,
    currentVoters: string[]
  ): PayoutBalances {
    logger.info("Starting to calculate shares...");
    const payouts: Map<string, BigNumber> = new Map();
    const feesPayouts: Map<string, BigNumber> = new Map();

    for (const item of forgedBlocks) {
      const height: number = item.height;
      const timestamp: number = item.timestamp;
      const totalFeesThisBlock: BigNumber = new BigNumber(item.fees);
      let validVoters: string[] = votersPerForgedBlock.get(height);
      const walletBalances: Map<
        string,
        BigNumber
      > = votersBalancePerForgedBlock.get(height);
      const balance: BigNumber = new BigNumber(
        this.sumBalances(walletBalances, validVoters)
      );

      if (this.config.poolHoppingProtection) {
        validVoters = this.filterPoolHoppers(validVoters, currentVoters);
      }

      for (const address of validVoters) {
        const payoutAddress: string = this.getRedirectAddress(address);
        const latestPayout: number = latestPayoutsTimeStamp.get(payoutAddress);

        if (typeof latestPayout === "undefined" || latestPayout <= timestamp) {
          let pendingPayout: BigNumber =
            typeof payouts.get(address) !== "undefined"
              ? new BigNumber(payouts.get(address))
              : new BigNumber(0);
          const voterBalance: BigNumber = new BigNumber(
            walletBalances.get(address)
          );

          // Only payout voters that had a ballance that exceeds or equals the configured minimum balance.
          if (voterBalance.gte(this.config.minimalBalance)) {
            const voterShare: BigNumber = voterBalance.div(balance);
            const rewardShare: BigNumber = new BigNumber(
              voterShare.times(this.config.blockReward)
            ).decimalPlaces(8);

            pendingPayout = pendingPayout.plus(rewardShare);
            payouts.set(address, pendingPayout);

            if (totalFeesThisBlock.gt(0)) {
              let pendingFeesPayout: BigNumber =
                typeof feesPayouts.get(address) !== "undefined"
                  ? new BigNumber(feesPayouts.get(address))
                  : new BigNumber(0);
              const feeShare: BigNumber = new BigNumber(
                voterShare.times(totalFeesThisBlock)
              ).decimalPlaces(8);
              pendingFeesPayout = pendingFeesPayout.plus(feeShare);
              feesPayouts.set(address, pendingFeesPayout);
            }
          }
        }
      }
    }
    logger.info("Finished calculating shares...");
    return { payouts, feesPayouts };
  }

  public sumVoterBalancesForBlock(
    blockVoterBalances: Map<string, BigNumber>
  ): BigNumber {
    let totalVoterBalancesThisBlock = new BigNumber(0);

    for (const [address] of blockVoterBalances) {
      const balance = new BigNumber(blockVoterBalances.get(address));
      totalVoterBalancesThisBlock = totalVoterBalancesThisBlock.plus(balance);
    }
    return totalVoterBalancesThisBlock;
  }

  private filterPoolHoppers(validVoters: string[], currentVoters: string[]) {
    validVoters = validVoters.filter(address => {
      return currentVoters.indexOf(address) >= 0;
    });
    return validVoters.slice(0);
  }

  private sumBalances(
    walletBalances: Map<string, BigNumber>,
    validVoters: string[]
  ): BigNumber {
    let balance: BigNumber = new BigNumber(0);

    walletBalances.forEach((bal: BigNumber, voter: string) => {
      // Only add this voter's balance to the total if it exceeds or equals the configured minimum balance.
      bal = new BigNumber(bal);
      if (
        validVoters.indexOf(voter) >= 0 &&
        bal.gte(this.config.minimalBalance)
      ) {
        balance = balance.plus(bal);
      }
    });

    return balance;
  }

  private getRedirectAddress(address: string): string {
    if (this.config.walletRedirections.hasOwnProperty(address) === true) {
      return this.config.walletRedirections[address]; // TODO validate address
    }
    return address;
  }
}
