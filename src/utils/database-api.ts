import { Interfaces } from "@arkecosystem/crypto";
import BigNumber from "bignumber.js";
import {
  DatabaseConfig,
  DelegateTransaction,
  ForgedBlock,
  Transaction,
  Voter,
  VoterBlock,
  VoterMutation
} from "../interfaces";
import { logger, Postgres } from "../services";
import { Crypto } from "./crypto";
import {
  getDelegateTransactions,
  getForgedBlocks,
  getTransactions,
  getVoterSinceHeight,
  getVotingDelegates
} from "./queries";
import {IMultiPaymentItem} from "@arkecosystem/crypto/dist/interfaces";

export class DatabaseAPI {
  private static deserializeTransaction(transaction, blockHeight: number): Interfaces.ITransaction {
    try {
      const buffer = Buffer.from(transaction, "hex");
      const serialized: string = Buffer.from(buffer).toString("hex");
      return Crypto.deserializeTransaction(serialized, blockHeight);
    } catch (error) {
      logger.error(`Deserializing transaction: ${error.message}`);
      return null;
    }
  }
  private readonly psql: Postgres;

  constructor(databaseConfig: DatabaseConfig) {
    this.psql = new Postgres(databaseConfig);
  }

  public async getForgedBlocks(
    delegatePublicKey: string,
    startBlockHeight: number,
    historyAmountBlocks: number
  ): Promise<ForgedBlock[]> {
    await this.psql.connect();
    const getForgedBlocksQuery: string = getForgedBlocks(
      delegatePublicKey,
      startBlockHeight,
      historyAmountBlocks
    );
    const result = await this.psql.query(getForgedBlocksQuery);
    await this.psql.close();

    if (result.rows.length === 0) {
      return [];
    }

    const forgedBlocks: ForgedBlock[] = result.rows.map(block => {
      return {
        height: parseInt(block.height, 10),
        fees: new BigNumber(block.totalFee),
        timestamp: parseInt(block.timestamp, 10)
      };
    });

    logger.info(
      `Forged blocks retrieved: ${JSON.stringify(forgedBlocks.length)} (${
        forgedBlocks[0].height
      } - ${forgedBlocks[forgedBlocks.length - 1].height})`
    );
    return forgedBlocks;
  }

  public async getDelegatePayoutTransactions(
    delegatePublicKey: string,
    startBlockHeight: number,
    payoutSignature: string
  ): Promise<DelegateTransaction[]> {
    const getDelegateTransactionsQuery = getDelegateTransactions(
      startBlockHeight,
      delegatePublicKey
    );
    await this.psql.connect();
    const result = await this.psql.query(getDelegateTransactionsQuery);
    await this.psql.close();

    if (result.rows.length === 0) {
      return [];
    }

    const delegatePayoutTransactions = result.rows
      .map(transaction => {
        const data = DatabaseAPI.deserializeTransaction(transaction.serialized, startBlockHeight);
        logger.warn(`TX: ${data.data.type} --  ${JSON.stringify(data)}`);
        return {
          height: parseInt(transaction.height, 10),
          recipientId: data.data.type === 0 ? transaction.recipient_id : null,
          multiPayment:  data.data.type  === 6 ? this.processMultiPayments(data.data.asset.payments) : null,
          vendorField:
            data && data.hasVendorField() ? data.data.vendorField : null,
          timestamp: parseInt(transaction.timestamp, 10)
        };
      })
      .filter(transaction => {
        return (
          transaction.vendorField &&
          transaction.vendorField.includes(payoutSignature)
        );
      });
    logger.info(
      `Delegate Payout Transactions retrieved: ${delegatePayoutTransactions.length}`
    );
    return delegatePayoutTransactions;
  }

  private processMultiPayments(payments: IMultiPaymentItem[]): IMultiPaymentItem[] {
    for(let x of payments) {
      logger.warn(`MultiPayment: ${JSON.stringify(x)}`);
    }
    return payments
  }
  /**
   * @dev  Get all the votes/unvotes for this delegate that are within range.
   */
  public async getVoterMutations(
    delegatePublicKey: string,
    startBlockHeight: number
  ): Promise<VoterMutation[]> {
    const getVoterSinceHeightQuery = getVoterSinceHeight(startBlockHeight);
    await this.psql.connect();
    const result = await this.psql.query(getVoterSinceHeightQuery);
    await this.psql.close();

    if (result.rows.length === 0) {
      return [];
    }

    return result.rows
      .map(transaction => {
        const data = DatabaseAPI.deserializeTransaction(transaction.serialized, startBlockHeight);
        return {
          height: parseInt(transaction.height, 10),
          address: transaction.recipient_id,
          vote: data ? data.data.asset.votes[0] : ""
        };
      })
      .filter(transaction => {
        return transaction.vote.includes(`${delegatePublicKey}`);
      });
  }

  public async getVotingDelegateBlocks(
    voterWallets: Voter[],
    startBlockHeight: number
  ): Promise<VoterBlock[]> {
    const wallets: Map<string, string> = new Map(
      voterWallets.map(wallet => [wallet.publicKey, wallet.address])
    );
    const getVotingDelegatesQuery: string = getVotingDelegates(
      startBlockHeight
    );
    await this.psql.connect();
    const result = await this.psql.query(getVotingDelegatesQuery);
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
          fees: new BigNumber(item.total_fee)
        };
        votingDelegateBlocks.push(block);
      }
    }

    return votingDelegateBlocks;
  }

  public async getTransactions(
    voters: string[],
    votersPublicKeys: string[],
    startBlockHeight: number,
    networkVersion: number
  ): Promise<Transaction[]> {
    const getTransactionsQuery = getTransactions(
      voters,
      votersPublicKeys,
      startBlockHeight
    );

    await this.psql.connect();
    const result = await this.psql.query(getTransactionsQuery);
    await this.psql.close();

    if (result.rows.length === 0) {
      return [];
    }

    const transactions: Transaction[] = result.rows.map(transaction => {
      const senderId: string = Crypto.getAddressFromPublicKey(
        transaction.sender_public_key,
        networkVersion
      );
      return {
        amount: new BigNumber(transaction.amount),
        height: parseInt(transaction.height, 10),
        recipientId: transaction.recipient_id,
        senderId,
        sender_public_key: transaction.sender_public_key,
        fee: new BigNumber(transaction.fee),
        timestamp: parseInt(transaction.timestamp, 10)
      };
    });

    logger.info(`Transactions retrieved: ${transactions.length}`);
    return transactions;
  }
}
