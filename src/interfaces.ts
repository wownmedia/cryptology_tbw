import { Interfaces } from "@arkecosystem/crypto";
import BigNumber from "bignumber.js";

export interface SmallWalletBonus {
  walletLimit: BigNumber;
  percentage: BigNumber;
}

export interface DatabaseConfig {
  user: string;
  host: string;
  database: string;
  password: string;
  port: number;
}

export interface Node {
  host: string;
  port: number;
}

export interface APIResults {
  meta?: any;
  data?: any;
}

export interface Voter {
  address: string;
  publicKey: string;
  secondPublicKey?: string;
  balance: BigNumber;
  isDelegate?: boolean;
  vote?: string;
  username?: string;
}

export interface Voters {
  votersPerForgedBlock: Map<number, string[]>;
  voters: string[];
  currentVoters: string[];
  voterWallets: Voter[];
}

export interface VoterMutation {
  height: number;
  address: string;
  vote: string;
}

export interface VoterBlock {
  height: number;
  address: string;
  fees: BigNumber;
}

export interface VoterBalances {
  voterBalances: Voter[];
  votersPublicKeys: string[];
}

export interface ForgedBlock {
  height: number;
  timestamp: number;
  fees: BigNumber;
}

export interface DelegateTransaction {
  height: number;
  recipientId: string;
  multiPayment: Interfaces.IMultiPaymentItem[];
  vendorField: string;
  timestamp: number;
}

export interface Transaction {
  amount: BigNumber;
  height: number;
  recipientId: string;
  senderId: string;
  senderPublicKey: string;
  multiPayment: Interfaces.IMultiPaymentItem[];
  fee: BigNumber;
  timestamp: number;
}

export interface MutatedVotersPerRound {
  voters: string[];
  votersPerRound: string[];
}

export interface VotersPerForgedBlock {
  voters: string[];
  votersPerForgedBlock: Map<number, string[]>;
}

export interface VoterBalancesPerForgedBlock {
  votersBalancePerForgedBlock: Map<number, Map<string, BigNumber>>;
  smallWallets: Map<string, boolean>;
}

export interface Payouts {
  payouts: Map<string, BigNumber>;
  delegateProfit: BigNumber;
  acfDonation: BigNumber;
  timestamp: number;
}

export interface PayoutBalances {
  payouts: Map<string, BigNumber>;
  feesPayouts: Map<string, BigNumber>;
}

export interface LatestPayouts {
  latestPayouts: Map<string, number>;
  latestPayoutsTimeStamp: Map<string, number>;
}

export interface Receiver {
  wallet: string;
  percentage?: BigNumber;
  amount?: BigNumber;
  vendorField?: string;
}
