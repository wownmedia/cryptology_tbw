import { Interfaces } from "@arkecosystem/crypto";
import axios from "axios";
import BigNumber from "bignumber.js";
import {
    APIResults,
    BroadcastResult,
    Node,
    Voter,
    VoterMutation,
} from "../interfaces";
import { logger } from "./";

export class Network {
    private readonly server: string;
    private readonly nodes: Node[];

    constructor(server: string, nodes: Node[]) {
        this.server = server;
        this.nodes = nodes;
    }

    /**
     *
     */
    public async getNetworkConfig(): Promise<Interfaces.INetworkConfig> {
        try {
            const config: APIResults = await this.getFromAPI(
                "/api/node/configuration/crypto"
            );
            return config.data;
        } catch (e) {
            return null;
        }
    }

    /**
     *
     */
    public async getCurrentHeight(): Promise<number> {
        try {
            const config: APIResults = await this.getFromAPI("/api/blockchain");
            return config.data.block.height;
        } catch (e) {
            return null;
        }
    }

    /**
     *
     * @param delegate
     */
    public async getNonceForDelegate(delegate: string): Promise<number> {
        try {
            const delegateWallet: string = await this.getDelegateAddress(
                delegate
            );
            return this.getNonceForWallet(delegateWallet);
        } catch (e) {
            return null;
        }
    }

    public async getNonceForWallet(wallet: string): Promise<number> {
        try {
            const walletInfo: APIResults = await this.getFromAPI(
                `/api/wallets/${wallet}`
            );
            const nonce: number =
                walletInfo.hasOwnProperty("data") &&
                walletInfo.data.hasOwnProperty("nonce")
                    ? parseInt(walletInfo.data.nonce, 10)
                    : null;
            logger.info(`Nonce loaded for ${wallet}: ${nonce}`);
            return nonce;
        } catch (e) {
            return null;
        }
    }

    /**
     *
     * @param endPoint
     * @param params
     */
    public async getFromAPI(
        endPoint: string,
        params = {}
    ): Promise<APIResults> {
        try {
            const node: string =
                typeof this.nodes[0] !== "undefined" &&
                this.nodes[0].hasOwnProperty("host") &&
                this.nodes[0].hasOwnProperty("port")
                    ? `http://${this.nodes[0].host}:${this.nodes[0].port}`
                    : this.server;
            const response = await axios.get(`${node}${endPoint}`, {
                params,
                headers: { "API-Version": 2 },
            });

            if (
                typeof response !== "undefined" &&
                response.hasOwnProperty("data")
            ) {
                return response.data;
            }
        } catch (error) {
            logger.error(`${error} for URL: ${endPoint}`);
        }
        return null;
    }

    /**
     * @dev Retrieve the delegate public key from the API
     */
    public async getDelegatePublicKey(delegate: string): Promise<string> {
        const getDelegateEndpoint: string = `/api/delegates/${delegate}/`;
        const delegateAPIResults: APIResults = await this.getFromAPI(
            getDelegateEndpoint
        );

        if (
            delegateAPIResults.hasOwnProperty("data") &&
            delegateAPIResults.data.hasOwnProperty("publicKey")
        ) {
            return delegateAPIResults.data.publicKey;
        }

        throw new Error("Could not retrieve delegate data.");
    }

    public async getDelegateAddress(delegate: string): Promise<string> {
        const getDelegateEndpoint: string = `/api/delegates/${delegate}/`;
        const delegateAPIResults: APIResults = await this.getFromAPI(
            getDelegateEndpoint
        );

        if (
            delegateAPIResults.hasOwnProperty("data") &&
            delegateAPIResults.data.hasOwnProperty("address")
        ) {
            return delegateAPIResults.data.address;
        }

        throw new Error("Could not retrieve delegate data.");
    }

    /**
     *
     * @param delegate
     */
    public async getVoters(delegate: string): Promise<Voter[]> {
        const getVotersEndpoint: string = `/api/delegates/${delegate}/voters`;
        const params = {
            page: 1,
            limit: 100,
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
                const address: string = item.address;
                const getWalletEndpoint: string = `/api/wallets/${address}/`;
                const walletAPIResult: APIResults = await this.getFromAPI(
                    getWalletEndpoint
                );
                if (
                    walletAPIResult &&
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
                        isDelegate: walletAPIResult.data.isDelegate,
                    };
                    allVotersFromAPI.push(voter);
                }
            }
        }
        return allVotersFromAPI;
    }

    /**
     *
     * @param transactions
     */
    public async broadcastTransactions(
        transactions: Interfaces.ITransactionData[]
    ): Promise<BroadcastResult[]> {
        const results: BroadcastResult[] = [];
        for (const item in this.nodes) {
            if (
                typeof this.nodes[item] !== "undefined" &&
                this.nodes[item].hasOwnProperty("host") &&
                this.nodes[item].hasOwnProperty("port")
            ) {
                const node: string = `http://${this.nodes[item].host}:${this.nodes[item].port}`;
                logger.info(
                    `Sending ${transactions.length} transactions to ${node}.`
                );
                const response = await axios.post(
                    `${node}/api/v2/transactions`,
                    {
                        transactions,
                    },
                    {
                        headers: { "Content-Type": "application/json" },
                    }
                );
                results.push({ node, response: response.data });
            }
        }

        return results;
    }
}
