import BigNumber from "bignumber.js";
import dotenv from "dotenv";
import { ARKTOSHI } from "../constants";
import { Node, Receiver, SmallWalletBonus } from "../interfaces";

dotenv.config();

export class Config {
    public readonly delegate: string;
    public readonly transferFee: BigNumber;
    public readonly noSignature: boolean;
    public adminFees: boolean;
    public readonly multiTransferFee: BigNumber;
    public readonly voterShare: BigNumber;
    public readonly voterFeeShare: BigNumber;
    public readonly voterBusinessShare: BigNumber;
    public readonly minimalPayoutValue: BigNumber;
    public readonly donationShare: BigNumber;
    public readonly minimalBalance: BigNumber;
    public readonly startFromBlockHeight: number;
    public readonly endAtBlockHeight: number;
    public readonly historyAmountBlocks: number;
    public readonly poolHoppingProtection: boolean;
    public readonly whitelistedVoters: string[];
    public readonly blacklistedVoters: string[];
    public readonly smallWalletBonus: SmallWalletBonus = {
        walletLimit: new BigNumber(0),
        percentage: new BigNumber(0),
    };
    public readonly customShares: number[];
    public readonly walletRedirections: string[];
    public readonly customPayoutFrequencies: number[];
    public readonly databaseHost: string;
    public readonly databaseUser: string;
    public readonly databasePassword: string;
    public readonly databaseDB: string;
    public readonly databasePort: number;
    public readonly server: string;
    public readonly nodes: Node[];
    public readonly vendorField: string;
    public readonly vendorFieldAdmin: string;
    public readonly vendorFieldDonation: string;
    public readonly admins: Receiver[];
    public readonly seed: string;
    public readonly secondPassphrase: string;
    public readonly businessSeed: string;
    public readonly businessSecondPassphrase: string;
    public transactionsPerRequest: number;
    public transactionsPerMultitransfer: number;

    constructor() {
        this.delegate = process.env.DELEGATE
            ? process.env.DELEGATE.toLowerCase().trim()
            : null;
        if (this.delegate === null || this.delegate === "") {
            throw new TypeError("Invalid DELEGATE configuration");
        }

        this.noSignature = process.env.NO_VENDORFIELD
            ? parseInt(process.env.NO_VENDORFIELD, 10) > 0
            : false;

        this.adminFees = process.env.ADMIN_PAYS_FEES
            ? parseInt(process.env.ADMIN_PAYS_FEES, 10) > 0
            : false;

        this.transferFee = process.env.FEE
            ? new BigNumber(process.env.FEE).times(ARKTOSHI)
            : new BigNumber(0.1).times(ARKTOSHI);
        if (this.transferFee.isNaN() || this.transferFee.lte(0)) {
            throw new TypeError("Invalid FEE configuration");
        }

        this.multiTransferFee = process.env.MULTI_TRANSFER_FEE
            ? new BigNumber(process.env.MULTI_TRANSFER_FEE).times(ARKTOSHI)
            : new BigNumber(0.5).times(ARKTOSHI);
        if (this.multiTransferFee.isNaN() || this.multiTransferFee.lte(0)) {
            throw new TypeError("Invalid MULTI_TRANSFER_FEE configuration");
        }

        this.voterShare = process.env.PAYOUT
            ? new BigNumber(process.env.PAYOUT)
            : new BigNumber(0);
        if (
            this.voterShare.isNaN() ||
            this.voterShare.gt(1) ||
            this.voterShare.lt(0)
        ) {
            throw new TypeError("Invalid PAYOUT configuration: must be between 0 and 1");
        }

        this.voterFeeShare = process.env.PAYOUT_FEES
            ? new BigNumber(process.env.PAYOUT_FEES)
            : this.voterShare;
        if (
            this.voterFeeShare.isNaN() ||
            this.voterFeeShare.gt(1) ||
            this.voterFeeShare.lt(0)
        ) {
            throw new TypeError("Invalid PAYOUT_FEES configuration");
        }

        this.voterBusinessShare = process.env.PAYOUT_BUSINESS
            ? new BigNumber(process.env.PAYOUT_BUSINESS)
            : new BigNumber(0);
        if (
            this.voterBusinessShare.isNaN() ||
            this.voterBusinessShare.gt(1) ||
            this.voterBusinessShare.lt(0)
        ) {
            throw new TypeError("Invalid PAYOUT_BUSINESS configuration");
        }

        this.minimalPayoutValue = process.env.MIN_PAYOUT_VALUE
            ? new BigNumber(process.env.MIN_PAYOUT_VALUE).times(ARKTOSHI)
            : new BigNumber(0.0025).times(ARKTOSHI);
        if (this.minimalPayoutValue.isNaN()) {
            throw new TypeError("Invalid MIN_PAYOUT_VALUE configuration");
        }

        this.donationShare = new BigNumber(0.005);

        this.minimalBalance = process.env.MIN_BALANCE
            ? new BigNumber(process.env.MIN_BALANCE).times(ARKTOSHI)
            : new BigNumber(1);
        if (this.minimalBalance.isNaN()) {
            throw new TypeError("Invalid MIN_BALANCE configuration");
        }

        this.startFromBlockHeight = process.env.START_BLOCK_HEIGHT
            ? parseInt(process.env.START_BLOCK_HEIGHT, 10)
            : 1;
        if (this.startFromBlockHeight < 1) {
            throw new TypeError("Invalid START_BLOCK_HEIGHT configuration");
        }

        this.endAtBlockHeight = process.env.END_BLOCK_HEIGHT
            ? parseInt(process.env.END_BLOCK_HEIGHT, 10)
            : null;
        if (
            Number.isInteger(this.endAtBlockHeight) &&
            this.endAtBlockHeight <= this.startFromBlockHeight
        ) {
            throw new TypeError("Invalid END_BLOCK_HEIGHT configuration");
        }

        this.historyAmountBlocks = process.env.MAX_HISTORY
            ? parseInt(process.env.MAX_HISTORY, 10)
            : 6400;
        if (this.historyAmountBlocks <= 0) {
            throw new TypeError("Invalid MAX_HISTORY configuration");
        }

        this.poolHoppingProtection = process.env.POOL_HOPPING_PROTECTION
            ? parseInt(process.env.POOL_HOPPING_PROTECTION, 10) > 0
            : false;

        this.whitelistedVoters = process.env.WHITELIST
            ? process.env.WHITELIST.split(",")
            : [];
        this.blacklistedVoters = process.env.BLOCKLIST
            ? process.env.BLOCKLIST.split(",")
            : [];

        if (process.env.SMALL_WALLET_BONUS) {
            this.smallWalletBonus = this.processSmallWalletBonus(
                JSON.parse(process.env.SMALL_WALLET_BONUS)
            );
        }

        this.customShares = process.env.CUSTOM_PAYOUT_LIST
            ? JSON.parse(process.env.CUSTOM_PAYOUT_LIST)
            : {};

        this.walletRedirections = process.env.CUSTOM_REDIRECTIONS
            ? JSON.parse(process.env.CUSTOM_REDIRECTIONS)
            : {};

        this.customPayoutFrequencies = process.env.CUSTOM_FREQUENCY
            ? JSON.parse(process.env.CUSTOM_FREQUENCY)
            : {};

        this.databaseUser = process.env.DB_USER ? process.env.DB_USER : "ark";
        this.databaseHost = process.env.DB_HOST
            ? process.env.DB_HOST
            : "localhost";
        this.databaseDB = process.env.DB_DATABASE
            ? process.env.DB_DATABASE
            : "ark_mainnet";
        this.databasePassword = process.env.DB_PASSWORD
            ? process.env.DB_PASSWORD
            : "password";
        this.databasePort = process.env.DB_PORT
            ? parseInt(process.env.DB_PORT, 10)
            : 5432;

        this.server = `http://${process.env.NODE}:${process.env.PORT}`;
        this.nodes = process.env.NODES
            ? JSON.parse(process.env.NODES)
            : [{ host: process.env.NODE, port: process.env.PORT }];

        this.vendorField = process.env.VENDORFIELD_MESSAGE
            ? process.env.VENDORFIELD_MESSAGE
            : "`Voter Share.";
        this.vendorFieldAdmin = process.env.VENDORFIELD_ADMINISTRATIVE_MESSAGE
            ? process.env.VENDORFIELD_ADMINISTRATIVE_MESSAGE
            : "Delegate Fee.";
        this.vendorFieldDonation = process.env.VENDORFIELD_LICENSE_MESSAGE
            ? process.env.VENDORFIELD_LICENSE_MESSAGE
            : "Cryptology TBW License Fee.";
        this.admins = process.env.ADMIN_PAYOUT_LIST
            ? this.processAdmins(JSON.parse(process.env.ADMIN_PAYOUT_LIST))
            : [];

        this.seed = process.env.SECRET ? process.env.SECRET : null;
        this.secondPassphrase = process.env.SECOND_SECRET
            ? process.env.SECOND_SECRET
            : null;

        this.businessSeed = process.env.BUSINESS_SECRET
            ? process.env.BUSINESS_SECRET
            : null;
        this.businessSecondPassphrase = process.env.BUSINESS_SECOND_SECRET
            ? process.env.BUSINESS_SECOND_SECRET
            : null;

        this.transactionsPerRequest = process.env.MAX_TRANSACTIONS_PER_REQUEST
            ? parseInt(process.env.MAX_TRANSACTIONS_PER_REQUEST, 10)
            : 40;

        this.transactionsPerMultitransfer = process.env.MAX_TRANSFERS_PER_MULTI
            ? parseInt(process.env.MAX_TRANSFERS_PER_MULTI, 10)
            : 64;
    }

    public processSmallWalletBonus(smallWalletBonusConfig): SmallWalletBonus {
        if (
            !smallWalletBonusConfig.hasOwnProperty("walletLimit") ||
            !smallWalletBonusConfig.hasOwnProperty("percentage")
        ) {
            throw new TypeError("Invalid SMALL_WALLET_BONUS configuration");
        }
        const smallWalletBonus: SmallWalletBonus = {
            walletLimit: new BigNumber(
                smallWalletBonusConfig.walletLimit
            ).times(ARKTOSHI),
            percentage: new BigNumber(smallWalletBonusConfig.percentage),
        };
        if (
            smallWalletBonus.walletLimit.isNaN() ||
            smallWalletBonus.walletLimit.lt(0) ||
            smallWalletBonus.percentage.isNaN() ||
            smallWalletBonus.percentage.gt(1) ||
            smallWalletBonus.percentage.lt(0)
        ) {
            throw new TypeError("Invalid SMALL_WALLET_BONUS configuration");
        }

        return smallWalletBonus;
    }

    public processAdmins(admins): Receiver[] {
        const receivers: Receiver[] = [];
        let totalPercentage = new BigNumber(0);
        for (const wallet in admins) {
            if (admins.hasOwnProperty(wallet)) {
                const receiver: Receiver = {
                    percentage: admins[wallet].hasOwnProperty("percentage")
                        ? new BigNumber(admins[wallet].percentage)
                        : new BigNumber(1),
                    vendorField: admins[wallet].hasOwnProperty("vendorField")
                        ? admins[wallet].vendorField
                        : this.vendorFieldAdmin,
                    wallet,
                };
                totalPercentage = totalPercentage.plus(receiver.percentage);
                if (totalPercentage.gt(1)) {
                    throw new TypeError("Admin payout percentage exceeds 100%");
                }
                receivers.push(receiver);
            }
        }
        return receivers;
    }
}
