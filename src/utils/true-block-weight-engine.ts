import { Identities } from "@arkecosystem/crypto";
import BigNumber from "bignumber.js";
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
    VotersPerForgedBlock,
} from "../interfaces";
import { Config, logger, Network } from "../services";
import { Crypto } from "./crypto";
import { DatabaseAPI } from "./database-api";
import { ProposalEngine } from "./proposal-engine";

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
            ROUNDING_MODE: BigNumber.ROUND_DOWN,
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
            port: this.config.databasePort,
        };
        this.databaseAPI = new DatabaseAPI(databaseConfig);
        this.proposalEngine = new ProposalEngine();
    }

    /**
     *
     */
    public async generatePayouts(): Promise<Payouts> {
        try {
            const delegatePublicKey: string = await this.network.getDelegatePublicKey(
                this.config.delegate
            );

            logger.info("Retrieving Forged Blocks.");
            const forgedBlocks: ForgedBlock[] = await this.databaseAPI.getForgedBlocks(
                delegatePublicKey,
                this.startBlockHeight,
                this.config.historyAmountBlocks
            );

            if (forgedBlocks.length === 0) {
                logger.error("No forged blocks retrieved!");
                return null;
            }

            const currentBlock: number = forgedBlocks[0].height;
            const timestamp: number = forgedBlocks[0].timestamp + 1;
            const oldestBlock: number =
                forgedBlocks[forgedBlocks.length - 1].height;
            this.startBlockHeight = oldestBlock - 1;

            logger.info("Retrieving Delegate Payouts.");
            const delegatePayoutTransactions: DelegateTransaction[] = await this.databaseAPI.getDelegatePayoutTransactions(
                delegatePublicKey,
                this.startBlockHeight,
                this.payoutSignature
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
                this.startBlockHeight
            );

            logger.info("Retrieving Voter Transactions.");
            const transactions: Transaction[] = await this.databaseAPI.getTransactions(
                voters.voters,
                voterBalances.publicKeys,
                this.startBlockHeight,
                this.config.networkVersion
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
            logger.error(error);
            return null;
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

        logger.info("Retrieving Voter mutations.");
        const voterMutations: VoterMutation[] = await this.databaseAPI.getVoterMutations(
            delegatePublicKey,
            this.startBlockHeight,
            this.config.networkVersion
        );

        const perForgedBlock: VotersPerForgedBlock = this.setVotersPerForgedBlock(
            voterMutations,
            currentVoters.slice(0),
            forgedBlocks
        );

        const voterWallets: Voter[] = await this.network.addMutatedVoters(
            voterMutations,
            currentVotersFromAPI,
            currentVoters
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
                calculatedVotersPerForgedBlock.set(
                    height,
                    votersRound.slice(0)
                );
            }
        );

        const votersPerForgedBlock: Map<number, string[]> = new Map(
            calculatedVotersPerForgedBlock
        );
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
        return voterMutations.filter(transaction => {
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
        let voterBalances: Voter[] = voterWallets.map(row => {
            return {
                address: row.address,
                publicKey: row.publicKey,
                balance: new BigNumber(row.balance),
            };
        });
        voterBalances = voterBalances.filter(wallet => {
            return voters.indexOf(wallet.address) > -1;
        });

        const votersPublicKeys: string[] = voterBalances.map(
            balances => balances.publicKey
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
        const latestPayoutsTimeStamp: Map<string, number> = new Map();

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
            } else {
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
                this.config.networkVersion
            );
            const businessTransactions: Transaction[] = await this.databaseAPI.getTransactions(
                [businessWallet],
                [businessPublicKey],
                this.startBlockHeight,
                this.config.networkVersion
            );
            if (businessTransactions.length === 0) {
                return null;
            }

            let previousHeight: number = null;
            const revenuePerForgedBlock: Map<number, BigNumber> = new Map(
                forgedBlocks.map(block => [block.height, new BigNumber(0)])
            );
            revenuePerForgedBlock.forEach(
                (revenue: BigNumber, height: number) => {
                    if (previousHeight === null) {
                        previousHeight = height + 1;
                    }

                    const calculatedTransactions: Transaction[] = businessTransactions.filter(
                        transaction => {
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
                                    transaction.amount.toFixed()
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
            voterBalances.map(voterBalances => [voterBalances.address, true])
        );
        let calculatedVoters: Map<string, BigNumber> = new Map(
            voterBalances.map(voterBalances => [
                voterBalances.address,
                new BigNumber(voterBalances.balance),
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
     * @param votersBalancePerForgedBlock
     * @param transactions
     * @param votingDelegateBlocks
     */
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

            if (item.multiPayment !== null) {
                for (const transaction of item.multiPayment) {
                    const transactionAmount: BigNumber = new BigNumber(
                        transaction.amount.toFixed()
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
        latestPayoutsTimeStamp: Map<string, number>,
        votersBalancePerForgedBlock: Map<number, Map<string, BigNumber>>,
        currentVoters: string[]
    ): PayoutBalances {
        logger.info("Starting to calculate shares...");
        const payouts: Map<string, BigNumber> = new Map();
        const feesPayouts: Map<string, BigNumber> = new Map();
        const businessPayouts: Map<string, BigNumber> = new Map();

        for (const item of forgedBlocks) {
            const height: number = item.height;
            const timestamp: number = item.timestamp;
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
                    currentVoters
                );
            }

            for (const address of validVoters) {
                const payoutAddress: string = this.getRedirectAddress(address);
                const latestPayout: number = latestPayoutsTimeStamp.get(
                    payoutAddress
                );

                if (
                    typeof latestPayout === "undefined" ||
                    latestPayout <= timestamp
                ) {
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
     */
    private filterPoolHoppers(validVoters: string[], currentVoters: string[]) {
        validVoters = validVoters.filter(address => {
            return currentVoters.indexOf(address) >= 0;
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

        if (!Identities.Address.validate(address, this.config.networkVersion)) {
            throw new Error(
                `${address} is not a valid address for this blockchain.`
            );
        }
        return address;
    }
}
