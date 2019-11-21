import axios from "axios";
import BigNumber from "bignumber.js";
import { APIResults, Node, Voter, VoterMutation } from "../interfaces";
import { logger } from "./";

export class Network {
  private readonly server: string;
  private readonly nodes: Node[];

  constructor(server: string, nodes: Node[]) {
    this.server = server;
    this.nodes = nodes;
  }

  public async getFromAPI(endPoint: string, params = {}): Promise<APIResults> {
    try {
      const node: string =
        typeof this.nodes[0] !== "undefined" &&
        this.nodes[0].hasOwnProperty("host") &&
        this.nodes[0].hasOwnProperty("port")
          ? `http://${this.nodes[0].host}:${this.nodes[0].port}`
          : this.server;
      const response = await axios.get(`${node}${endPoint}`, {
        params,
        headers: { "API-Version": 2 }
      });

      if (typeof response !== "undefined" && response.hasOwnProperty("data")) {
        return response.data;
      }
    } catch (error) {
      logger.error(error);
    }
    return null;
  }

  /**
   * @dev Retrieve the delegate public key from the API
   */
  public async getDelegatePublicKey(delegate: string): Promise<string> {
    const getDelegateEndpoint = `/api/delegates/${delegate}/`;
    const delegateAPIResults: APIResults = await this.getFromAPI(
      getDelegateEndpoint
    );

    if (
      delegateAPIResults.hasOwnProperty("data") &&
      delegateAPIResults.data.hasOwnProperty("publicKey")
    ) {
      logger.info(
        `${delegate}'s Public Key: ${delegateAPIResults.data.publicKey}`
      );
      return delegateAPIResults.data.publicKey;
    }

    throw new Error("Could not retrieve delegate data.");
  }

  public async getVoters(delegate: string): Promise<Voter[]> {
    const getVotersEndpoint: string = `/api/delegates/${delegate}/voters`;
    const params = {
      page: 1,
      limit: 100
    };

    let votersAPIResults: APIResults;
    let voters: Voter[] = [];
    do {
      votersAPIResults = await this.getFromAPI(getVotersEndpoint, params);
      if (
        votersAPIResults.hasOwnProperty("data") &&
        votersAPIResults.data.length > 0
      ) {
        voters = voters.concat(votersAPIResults.data);
      }
      params.page++;
    } while (
      votersAPIResults.hasOwnProperty("data") &&
      votersAPIResults.data.length > 0
    );

    return voters;
  }

  /**
   * @dev  Add wallets for voters that unvoted
   */
  public async addMutatedVoters(
    voterMutations: VoterMutation[],
    currentVotersFromAPI: Voter[],
    currentVoters: string[]
  ): Promise<Voter[]> {
    const allVotersFromAPI: Voter[] = currentVotersFromAPI.slice(0);
    for (const item of voterMutations) {
      if (
        item.hasOwnProperty("address") &&
        currentVoters.indexOf(item.address) < 0
      ) {
        const address = item.address;
        const getWalletEndpoint = `/api/wallets/${address}/`;
        const walletAPIResult = await this.getFromAPI(getWalletEndpoint);
        if (
          walletAPIResult.hasOwnProperty("data") &&
          walletAPIResult.data.hasOwnProperty("address") &&
          walletAPIResult.data.hasOwnProperty("publicKey") &&
          walletAPIResult.data.hasOwnProperty("balance") &&
          walletAPIResult.data.hasOwnProperty("isDelegate")
        ) {
          const voter: Voter = {
            address: walletAPIResult.data.address,
            publicKey: walletAPIResult.data.publicKey,
            balance: new BigNumber(walletAPIResult.data.balance),
            isDelegate: walletAPIResult.data.isDelegate
          };
          allVotersFromAPI.push(voter);
        }
      }
    }
    return allVotersFromAPI;
  }

  // TODO transactions interface
  public async postTransaction(transactions): Promise<void> {
    logger.info(
      `Sending ${transactions.length} transactions to ${this.server}.`
    );
    return axios.post(
      `${this.server}/api/v2/transactions`,
      {
        transactions
      },
      {
        headers: { "Content-Type": "application/json" }
      }
    );
  }

  // TODO transactions interface
  public async broadcastTransactions(transactions) {
    const results = [];
    for (const item in this.nodes) {
      if (
        typeof this.nodes[item] !== "undefined" &&
        this.nodes[item].hasOwnProperty("host") &&
        this.nodes[item].hasOwnProperty("port")
      ) {
        const node = `http://${this.nodes[item].host}:${this.nodes[item].port}`;
        logger.info(`Sending ${transactions.length} transactions to ${node}.`);
        const response = await axios.post(
          `${node}/api/v2/transactions`,
          {
            transactions
          },
          {
            headers: { "Content-Type": "application/json" }
          }
        );
        results.push({ node, response: response.data });
      }
    }

    return results;
  }
}
