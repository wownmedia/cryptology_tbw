import { Identities, Interfaces } from "@arkecosystem/crypto";
import BigNumber from "bignumber.js";
import {
    DatabaseConfig,
    DelegateTransaction,
    ForgedBlock,
    LatestPayouts,
    MutatedVotersPerRound,
    PayoutBalances,
    Payouts,
    Stake,
    StakeTimestamp,
    Transaction,
    Voter,
    VoterBalances,
    VoterBalancesPerForgedBlock,
    VoterBlock,
    VoterMutation,
    Voters,
    VotersPerForgedBlock,
} from "../interfaces";
import { Config, logger, Network } from "../services";
import { Crypto } from "./crypto";
import { DatabaseAPI } from "./database-api";
import { ProposalEngine } from "./proposal-engine";
import moment from "moment";

export class TrueBlockWeightEngine {
    /**
     * Create an array of the current voters
     * @param currentVotersFromAPI
     */
    private static formatCurrentVoters(
        currentVotersFromAPI: Voter[]
    ): string[] {
        if (currentVotersFromAPI.length === 0) {
            return [];
        }
        return currentVotersFromAPI.map((voter) => voter.address);
    }

    private readonly config: Config;
    private readonly network: Network;
    private readonly databaseAPI: DatabaseAPI;
    private readonly proposalEngine: ProposalEngine;
    private readonly payoutSignature: string;
    private startBlockHeight: number;
    private readonly endBlockHeight: number;
    private networkConfig: Interfaces.INetworkConfig;
    private epochTimestamp: BigNumber;
    private networkVersion: number;

    constructor() {
        BigNumber.config({
            ROUNDING_MODE: BigNumber.ROUND_DOWN,
        });

        this.config = new Config();
        this.payoutSignature = `${this.config.delegate} - `;
        this.startBlockHeight = this.config.startFromBlockHeight;
        this.endBlockHeight = this.config.endAtBlockHeight;
        this.network = new Network(this.config.server, this.config.nodes);
        const databaseConfig: DatabaseConfig = {
            host: this.config.databaseHost,
            user: this.config.databaseUser,
            database: this.config.databaseDB,
            password: this.config.databasePassword,
            port: this.config.databasePort,
        };
        this.databaseAPI = new DatabaseAPI(databaseConfig);
        this.proposalEngine = new ProposalEngine();
    }

    /**
     * @dev Calculate a timestamp based on an epoch
     * @param epoch {string} Epoch (e.g. "2019-05-24T11:48:58.165Z")
     * @returns {number}    The calculated timestamp
     * @private
     */
    private static calculateTimestamp(epoch: string): BigNumber {
        const epochTime = moment(epoch).utc().valueOf();
        return new BigNumber(Math.floor(epochTime / 1000));
    }

    /**
     *
     */
    public async generatePayouts(): Promise<Payouts> {
        try {
            this.networkConfig = await this.network.getNetworkConfig();
            this.epochTimestamp = TrueBlockWeightEngine.calculateTimestamp(
                this.networkConfig.milestones[0].epoch
            );
            this.networkVersion = this.networkConfig.network.pubKeyHash;

            const delegatePublicKey: string = await this.network.getDelegatePublicKey(
                this.config.delegate
            );

            logger.info("Retrieving Forged Blocks.");
            const forgedBlocks: ForgedBlock[] = await this.databaseAPI.getForgedBlocks(
                delegatePublicKey,
                this.startBlockHeight,
                this.endBlockHeight,
                this.config.historyAmountBlocks
            );

            const currentBlock: number = forgedBlocks[0].height;
            const timestamp: BigNumber = forgedBlocks[0].timestamp.plus(1);
            const oldestBlock: number =
                forgedBlocks[forgedBlocks.length - 1].height;

            if (this.startBlockHeight < oldestBlock - 1) {
                this.startBlockHeight = oldestBlock - 1;
            }

            logger.info(`Starting calculations from ${this.startBlockHeight}`);

            logger.info("Retrieving Delegate Payouts.");
            const delegatePayoutTransactions: DelegateTransaction[] = await this.databaseAPI.getDelegatePayoutTransactions(
                delegatePublicKey,
                this.startBlockHeight,
                this.endBlockHeight,
                this.payoutSignature,
                this.config.noSignature
            );

            logger.info("Retrieving Voters.");
            const voters: Voters = await this.getVoters(
                delegatePublicKey,
                forgedBlocks
            );

            logger.info("Retrieving Voter Balances.");
            const voterBalances: VoterBalances = await this.getVoterBalances(
                voters.voters,
                voters.voterWallets
            );

            logger.info("Retrieving Voters forged blocks.");
            const votingDelegateBlocks: VoterBlock[] = await this.databaseAPI.getVotingDelegateBlocks(
                voters.voterWallets,
                this.startBlockHeight,
                this.endBlockHeight
            );

            if (voters.voterWallets.length === 0) {
                logger.error("There are no voters to be calculated.");
                return null;
            }

            logger.info("Retrieving Voter Transactions.");
            const transactions: Transaction[] = await this.databaseAPI.getTransactions(
                voters.voters,
                voterBalances.publicKeys,
                this.startBlockHeight,
                this.endBlockHeight,
                this.networkVersion
            );

            const previousPayouts: LatestPayouts = this.findLatestPayouts(
                delegatePayoutTransactions
            );

            logger.info("Processing Voter Balances.");
            const processedBalances: VoterBalancesPerForgedBlock = this.processBalances(
                forgedBlocks,
                voterBalances.balances,
                transactions,
                votingDelegateBlocks
            );

            const businessRevenue: Map<
                number,
                BigNumber
            > = await this.getBusinessIncome(forgedBlocks);

            const voterShares: PayoutBalances = this.generateShares(
                voters.votersPerForgedBlock,
                forgedBlocks,
                businessRevenue,
                previousPayouts.latestPayoutsTimeStamp,
                processedBalances.votersBalancePerForgedBlock,
                voters.currentVoters
            );

            logger.info("Applying Proposal.");
            const proposal: Payouts = this.proposalEngine.applyProposal(
                currentBlock,
                previousPayouts.latestPayouts,
                processedBalances.smallWallets,
                voterShares.payouts,
                voterShares.feesPayouts,
                voterShares.businessPayouts
            );
            proposal.timestamp = timestamp;

            return proposal;
        } catch (error) {
            throw error;
        }
    }

    /**
     *
     * @param delegatePublicKey
     * @param forgedBlocks
     */
    public async getVoters(
        delegatePublicKey: string,
        forgedBlocks: ForgedBlock[]
    ): Promise<Voters> {
        logger.info("Retrieving Current Voters from API.");
        const currentVotersFromAPI: Voter[] = await this.network.getVoters(
            this.config.delegate
        );
        const currentVoters: string[] = TrueBlockWeightEngine.formatCurrentVoters(
            currentVotersFromAPI
        );

        logger.info(
            `There are ${currentVoters.length} wallets currently voting.`
        );

        logger.info("Retrieving Voter mutations.");
        const voterMutations: VoterMutation[] = await this.databaseAPI.getVoterMutations(
            delegatePublicKey,
            this.startBlockHeight,
            this.endBlockHeight,
            this.networkVersion
        );

        const perForgedBlock: VotersPerForgedBlock = this.setVotersPerForgedBlock(
            voterMutations,
            currentVoters.slice(0),
            forgedBlocks
        );

        const voterWallets: Voter[] = await this.network.addMutatedVoters(
            voterMutations,
            currentVotersFromAPI,
            currentVoters,
            this.epochTimestamp
        );

        return {
            votersPerForgedBlock: perForgedBlock.votersPerForgedBlock,
            voters: perForgedBlock.validVoters,
            currentVoters,
            voterWallets,
        };
    }

    /**
     *
     * @param voterMutations
     * @param voters
     * @param forgedBlocks
     */
    public setVotersPerForgedBlock(
        voterMutations: VoterMutation[],
        voters: string[],
        forgedBlocks: ForgedBlock[]
    ): VotersPerForgedBlock {
        let votersRound: string[] = voters.slice(0);
        let previousHeight: number = null;
        const calculatedVotersPerForgedBlock: Map<number, string[]> = new Map(
            forgedBlocks.map((block) => [block.height, []])
        );

        calculatedVotersPerForgedBlock.forEach(
            (votersDuringBlock: string[], height: number) => {
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
                calculatedVotersPerForgedBlock.set(
                    height,
                    votersRound.slice(0)
                );
            }
        );

        const votersPerForgedBlock: Map<number, string[]> = new Map(
            calculatedVotersPerForgedBlock
        );
        calculatedVotersPerForgedBlock.forEach((voters, height) => {
            logger.info(`${height} voters ${voters.forEach((wallet) => {wallet})}`);
        });

        const validVoters: string[] = this.processWhiteList(voters);
        return { votersPerForgedBlock, validVoters };
    }

    /**
     *
     * @param voterMutations
     * @param height
     * @param previousHeight
     */
    public filterVoteTransactionsForRound(
        voterMutations: VoterMutation[],
        height: number,
        previousHeight: number
    ): VoterMutation[] {
        return voterMutations.filter((transaction) => {
            return (
                transaction.height >= height &&
                transaction.height < previousHeight
            );
        });
    }

    /**
     *
     * @param height
     * @param previousHeight
     * @param votersPerRound
     * @param voters
     * @param voteTransactions
     */
    public mutateVoters(
        height: number,
        previousHeight: number,
        votersPerRound: string[],
        voters: string[],
        voteTransactions: VoterMutation[]
    ): MutatedVotersPerRound {
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

    /**
     *
     * @param voters
     */
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

    /**
     *
     * @param voters
     * @param voterWallets
     */
    public async getVoterBalances(
        voters: string[],
        voterWallets: Voter[]
    ): Promise<VoterBalances> {
        let voterBalances: Voter[] = voterWallets.map((row) => {
            const power: BigNumber = row.power
                ? new BigNumber(row.power)
                : new BigNumber(0);
            const balance: BigNumber = power.gt(new BigNumber(row.balance))
                ? power
                : new BigNumber(row.balance);
            return {
                address: row.address,
                publicKey: row.publicKey,
                balance,
                power: new BigNumber(row.power),
                processedStakes: this.network.processStakes(
                    row,
                    this.epochTimestamp
                ),
            };
        });
        voterBalances = voterBalances.filter((wallet) => {
            return voters.indexOf(wallet.address) > -1;
        });

        const votersPublicKeys: string[] = voterBalances.map(
            (balances) => balances.publicKey
        );
        return { balances: voterBalances, publicKeys: votersPublicKeys };
    }

    /**
     *
     * @param delegatePayoutTransactions
     */
    public findLatestPayouts(
        delegatePayoutTransactions: DelegateTransaction[]
    ): LatestPayouts {
        const latestPayouts: Map<string, number> = new Map();
        const latestPayoutsTimeStamp: Map<string, BigNumber> = new Map();

        for (const transaction of delegatePayoutTransactions) {
            if (transaction.recipientId !== null) {
                const height: BigNumber = new BigNumber(
                    latestPayouts.get(transaction.recipientId)
                );
                if (
                    height.isNaN() ||
                    height.lt(new BigNumber(transaction.height))
                ) {
                    latestPayouts.set(
                        transaction.recipientId,
                        transaction.height
                    );
                    latestPayoutsTimeStamp.set(
                        transaction.recipientId,
                        transaction.timestamp
                    );
                }
            } else if (transaction.multiPayment !== null) {
                for (const receiver of transaction.multiPayment) {
                    const height: BigNumber = new BigNumber(
                        latestPayouts.get(receiver.recipientId)
                    );
                    if (
                        height.isNaN() ||
                        height.lt(new BigNumber(transaction.height))
                    ) {
                        latestPayouts.set(
                            receiver.recipientId,
                            transaction.height
                        );
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

    public async getBusinessIncome(
        forgedBlocks: ForgedBlock[]
    ): Promise<Map<number, BigNumber>> {
        if (this.config.businessSeed) {
            const businessPublicKey: string = Crypto.getPublicKeyFromSeed(
                this.config.businessSeed
            );
            const businessWallet: string = Crypto.getAddressFromPublicKey(
                businessPublicKey,
                this.networkVersion
            );
            const businessTransactions: Transaction[] = await this.databaseAPI.getTransactions(
                [businessWallet],
                [businessPublicKey],
                this.startBlockHeight,
                this.endBlockHeight,
                this.networkVersion
            );
            if (businessTransactions.length === 0) {
                return null;
            }

            let previousHeight: number = null;
            const revenuePerForgedBlock: Map<number, BigNumber> = new Map(
                forgedBlocks.map((block) => [block.height, new BigNumber(0)])
            );
            revenuePerForgedBlock.forEach(
                (revenue: BigNumber, height: number) => {
                    if (previousHeight === null) {
                        previousHeight = height + 1;
                    }

                    const calculatedTransactions: Transaction[] = businessTransactions.filter(
                        (transaction) => {
                            return (
                                transaction.height >= height &&
                                transaction.height < previousHeight
                            );
                        }
                    );

                    let amount: BigNumber = new BigNumber(0);
                    for (const item of calculatedTransactions) {
                        const recipientId: string = item.recipientId;

                        if (item.multiPayment !== null) {
                            for (const transaction of item.multiPayment) {
                                const transactionAmount: BigNumber = new BigNumber(
                                    transaction.amount.toString()
                                );

                                if (
                                    transaction.recipientId === businessWallet
                                ) {
                                    amount = amount.plus(transactionAmount);
                                }
                            }
                        } else {
                            if (recipientId === businessWallet) {
                                amount = amount.plus(item.amount);
                            }
                        }
                    }
                    revenuePerForgedBlock.set(height, amount);
                    previousHeight = height;
                }
            );

            return revenuePerForgedBlock;
        }

        return null;
    }

    /**
     *
     * @param forgedBlocks
     * @param voterBalances
     * @param transactions
     * @param votingDelegateBlocks
     */
    public processBalances(
        forgedBlocks: ForgedBlock[],
        voterBalances: Voter[],
        transactions: Transaction[],
        votingDelegateBlocks: VoterBlock[]
    ): VoterBalancesPerForgedBlock {
        const smallWallets: Map<string, boolean> = new Map(
            voterBalances.map((voterBalances) => [voterBalances.address, true])
        );
        let calculatedVoters: Map<string, BigNumber> = new Map(
            voterBalances.map((voterBalances) => [
                voterBalances.address,
                new BigNumber(voterBalances.balance),
            ])
        );
        let previousHeight: number = null;
        let minTimestamp: BigNumber = new BigNumber(0);
        let maxTimestamp: BigNumber = new BigNumber(0);

        const timestampPerForgedBlock: Map<number, BigNumber> = new Map(
            forgedBlocks.map((block) => [block.height, block.timestamp])
        );

        const votersBalancePerForgedBlock: Map<
            number,
            Map<string, BigNumber>
        > = new Map(forgedBlocks.map((block) => [block.height, null]));

        votersBalancePerForgedBlock.forEach(
            (votersDuringBlock: Map<string, BigNumber>, height: number) => {
                if (previousHeight === null) {
                    previousHeight = height + 1;
                }

                const timestamp = timestampPerForgedBlock.get(height);
                maxTimestamp = minTimestamp;
                minTimestamp = timestamp.minus(1);

                if (maxTimestamp.eq(0)) {
                    maxTimestamp = timestamp;
                }

                calculatedVoters = this.mutateVotersBalances(
                    height,
                    previousHeight,
                    maxTimestamp,
                    minTimestamp,
                    calculatedVoters,
                    transactions,
                    voterBalances,
                    votingDelegateBlocks
                );
                previousHeight = height;
                votersBalancePerForgedBlock.set(
                    height,
                    new Map(calculatedVoters)
                );
                calculatedVoters.forEach(
                    (balance: BigNumber, address: string) => {
                        if (
                            new BigNumber(balance).gt(
                                this.config.smallWalletBonus.walletLimit
                            ) &&
                            smallWallets.get(address) === true
                        ) {
                            smallWallets.set(address, false);
                        }
                    }
                );
            }
        );

        return { votersBalancePerForgedBlock, smallWallets };
    }

    /**
     *
     * @param height
     * @param previousHeight
     * @param maxTimestamp
     * @param minTimestamp
     * @param votersBalancePerForgedBlock
     * @param transactions
     * @param voters
     * @param votingDelegateBlocks
     */
    public mutateVotersBalances(
        height: number,
        previousHeight: number,
        maxTimestamp: BigNumber,
        minTimestamp: BigNumber,
        votersBalancePerForgedBlock: Map<string, BigNumber>,
        transactions: Transaction[],
        voters: Voter[],
        votingDelegateBlocks
    ): Map<string, BigNumber> {
        // Only process mutations that are in range
        const calculatedTransactions: Transaction[] = transactions.filter(
            (transaction) => {
                return (
                    transaction.height >= height &&
                    transaction.height < previousHeight
                );
            }
        );

        for (const item of calculatedTransactions) {
            const recipientId: string = item.recipientId;
            const senderId: string = item.senderId;
            let amount: BigNumber = item.amount;
            const fee: BigNumber = item.fee;
            const stakeRedeemID = item.stakeRedeem;

            if (item.multiPayment) {
                for (const transaction of item.multiPayment) {
                    const transactionAmount: BigNumber = new BigNumber(
                        transaction.amount.toString()
                    );
                    amount = amount.plus(transactionAmount);
                    if (
                        votersBalancePerForgedBlock.has(transaction.recipientId)
                    ) {
                        let balance: BigNumber = votersBalancePerForgedBlock.get(
                            transaction.recipientId
                        );
                        balance = balance.minus(transactionAmount);
                        if (balance.lt(0)) {
                            balance = new BigNumber(0);
                        }
                        votersBalancePerForgedBlock.set(
                            transaction.recipientId,
                            balance
                        );
                    }
                }
            } else {
                if (votersBalancePerForgedBlock.has(recipientId)) {
                    let balance: BigNumber = votersBalancePerForgedBlock.get(
                        recipientId
                    );

                    balance = balance.minus(amount);

                    if (balance.lt(0)) {
                        balance = new BigNumber(0);
                    }
                    votersBalancePerForgedBlock.set(recipientId, balance);
                }
            }

            if (votersBalancePerForgedBlock.has(senderId)) {
                let balance: BigNumber = votersBalancePerForgedBlock.get(
                    senderId
                );

                if (stakeRedeemID !== null) {
                    let processedStakes: Stake[] = [];
                    for (const item in voters) {
                        if (voters[item] && voters[item].address === senderId) {
                            processedStakes = voters[item].processedStakes;
                            break;
                        }
                    }
                    const redeemValue: BigNumber = TrueBlockWeightEngine.getStakeRedeemValue(
                        processedStakes,
                        stakeRedeemID
                    );
                    balance = balance.plus(redeemValue);
                } else {
                    balance = balance.plus(amount);
                    balance = balance.plus(fee);
                }
                votersBalancePerForgedBlock.set(senderId, balance);
            }
        }

        for (const item in voters) {
            if (
                voters[item] &&
                voters[item].hasOwnProperty("processedStakes")
            ) {
                const stakes: Stake[] = voters[item].processedStakes;
                const wallet: string = voters[item].address;
                for (const stake in stakes) {
                    if (stakes[stake].hasOwnProperty("timestamps")) {
                        const stakeTimestamp: StakeTimestamp =
                            stakes[stake].timestamps;

                        let balance: BigNumber = votersBalancePerForgedBlock.get(
                            wallet
                        );

                        if (
                            stakeTimestamp.powerUp.lte(maxTimestamp) &&
                            stakeTimestamp.powerUp.gt(minTimestamp)
                        ) {
                            balance = balance
                                .minus(stakes[stake].power)
                                .plus(stakes[stake].amount);
                            votersBalancePerForgedBlock.set(wallet, balance);
                        }

                        if (
                            stakeTimestamp.redeemable.lte(maxTimestamp) &&
                            stakeTimestamp.redeemable.gt(minTimestamp)
                        ) {
                            const redeemValue: BigNumber = TrueBlockWeightEngine.getStakeRedeemValue(
                                stakes,
                                stakes[stake].id
                            );
                            balance = balance.plus(redeemValue);
                            votersBalancePerForgedBlock.set(wallet, balance);
                        }
                    }
                }
            }
        }

        const calculatedVotingDelegateBlocks: VoterBlock[] = votingDelegateBlocks.filter(
            (block) => {
                return block.height > height && block.height <= previousHeight;
            }
        );

        for (const item of calculatedVotingDelegateBlocks) {
            const delegateAddress: string = item.address;
            const gains: BigNumber = item.fees.plus(item.reward);

            if (
                gains.gt(0) &&
                votersBalancePerForgedBlock.has(delegateAddress)
            ) {
                let balance = new BigNumber(
                    votersBalancePerForgedBlock.get(delegateAddress)
                );
                balance = balance.minus(gains);
                if (balance.lt(0)) {
                    balance = new BigNumber(0);
                }
                votersBalancePerForgedBlock.set(delegateAddress, balance);
            }
        }

        return votersBalancePerForgedBlock;
    }

    private static getStakeRedeemValue(
        processedStakes: Stake[],
        stakeID: string
    ): BigNumber {
        let stakeRedeemAmount: BigNumber = new BigNumber(0);
        for (const stake in processedStakes) {
            if (
                processedStakes[stake] &&
                processedStakes[stake].hasOwnProperty("id") &&
                processedStakes[stake].id === stakeID
            ) {
                stakeRedeemAmount = processedStakes[stake].power.minus(
                    processedStakes[stake].amount
                );
            }
        }
        return stakeRedeemAmount.div(2);
    }

    /**
     *
     * @param votersPerForgedBlock
     * @param forgedBlocks
     * @param businessRevenue
     * @param latestPayoutsTimeStamp
     * @param votersBalancePerForgedBlock
     * @param currentVoters
     */
    public generateShares(
        votersPerForgedBlock: Map<number, string[]>,
        forgedBlocks: ForgedBlock[],
        businessRevenue: Map<number, BigNumber>,
        latestPayoutsTimeStamp: Map<string, BigNumber>,
        votersBalancePerForgedBlock: Map<number, Map<string, BigNumber>>,
        currentVoters: string[]
    ): PayoutBalances {
        logger.info("Starting to calculate shares...");
        const payouts: Map<string, BigNumber> = new Map();
        const feesPayouts: Map<string, BigNumber> = new Map();
        const businessPayouts: Map<string, BigNumber> = new Map();

        const currentBalances: Map<
            string,
            BigNumber
        > = votersBalancePerForgedBlock.get(forgedBlocks[0].height);
        for (const item of forgedBlocks) {
            const height: number = item.height;
            const timestamp: BigNumber = item.timestamp;
            const rewardThisBlock: BigNumber = item.reward;
            const totalFeesThisBlock: BigNumber = new BigNumber(item.fees);
            const totalBusinessIncomeThisBlock: BigNumber =
                businessRevenue === null
                    ? new BigNumber(0)
                    : new BigNumber(businessRevenue.get(height));
            let validVoters: string[] = votersPerForgedBlock.get(height);
            const walletBalances: Map<
                string,
                BigNumber
            > = votersBalancePerForgedBlock.get(height);
            const balance: BigNumber = new BigNumber(
                this.sumBalances(walletBalances, validVoters)
            );

            if (this.config.poolHoppingProtection) {
                validVoters = this.filterPoolHoppers(
                    validVoters,
                    currentVoters,
                    currentBalances
                );
            }

            for (const address of validVoters) {
                const payoutAddress: string = this.getRedirectAddress(address);
                const latestPayout: BigNumber = latestPayoutsTimeStamp.get(
                    payoutAddress
                );

                if (
                    typeof latestPayout === "undefined" ||
                    latestPayout.lte(timestamp)
                ) {
                    let pendingPayout: BigNumber =
                        typeof payouts.get(address) !== "undefined"
                            ? new BigNumber(payouts.get(address))
                            : new BigNumber(0);
                    const voterBalance: BigNumber = new BigNumber(
                        walletBalances.get(address)
                    );

                    // Only payout voters that had a balance that exceeds or equals the configured minimum balance.
                    if (voterBalance.gte(this.config.minimalBalance)) {
                        const voterShare: BigNumber = voterBalance.div(balance);
                        const rewardShare: BigNumber = new BigNumber(
                            voterShare.times(rewardThisBlock)
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
                            pendingFeesPayout = pendingFeesPayout.plus(
                                feeShare
                            );
                            feesPayouts.set(address, pendingFeesPayout);
                        }

                        if (totalBusinessIncomeThisBlock.gt(0)) {
                            let pendingBusinessPayout: BigNumber =
                                typeof businessPayouts.get(address) !==
                                "undefined"
                                    ? new BigNumber(
                                          businessPayouts.get(address)
                                      )
                                    : new BigNumber(0);
                            const businessShare: BigNumber = new BigNumber(
                                voterShare.times(totalBusinessIncomeThisBlock)
                            ).decimalPlaces(8);
                            pendingBusinessPayout = pendingBusinessPayout.plus(
                                businessShare
                            );
                            businessPayouts.set(address, pendingBusinessPayout);
                        }
                    }
                }
            }
        }

        logger.info("Finished calculating shares...");
        return { payouts, feesPayouts, businessPayouts };
    }

    /**
     *
     * @param validVoters
     * @param currentVoters
     * @param currentBalances
     */
    private filterPoolHoppers(
        validVoters: string[],
        currentVoters: string[],
        currentBalances: Map<string, BigNumber>
    ) {
        validVoters = validVoters.filter((address) => {
            const balance: BigNumber = currentBalances.get(address);
            const isCurrentVoter: boolean = currentVoters.indexOf(address) >= 0;
            return isCurrentVoter && balance && balance.gt(0);
        });

        return validVoters.slice(0);
    }

    /**
     *
     * @param walletBalances
     * @param validVoters
     */
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

    /**
     *
     * @param address
     */
    private getRedirectAddress(address: string): string {
        if (this.config.walletRedirections.hasOwnProperty(address) === true) {
            address = this.config.walletRedirections[address];
        }

        if (!Identities.Address.validate(address, this.networkVersion)) {
            throw new Error(
                `${address} is not a valid address for this blockchain.`
            );
        }
        return address;
    }
}
