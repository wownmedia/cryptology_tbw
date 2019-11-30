import {
    Identities,
    Interfaces,
    Managers,
    Transactions,
} from "@arkecosystem/crypto";

export class Crypto {
    /**
     * Generate an Address from a public key for a blockchain.
     * @param {string} publicKey The public key of the wallet to generate the address for.
     * @param {number} networkVersion The network version of the blockchain to generate the address for.
     * @returns {string} The generated address.
     * @static
     */
    public static getAddressFromPublicKey(
        publicKey: string,
        networkVersion: number
    ): string {
        return Identities.Address.fromPublicKey(publicKey, networkVersion);
    }

    /**
     * Deserialize a transaction
     * @param {string} serialized The serialized transaction
     * @param {number} blockHeight The height of the blockchain, this is used to determine if version 2 is enabled.
     * @returns The transaction object.
     * @static
     */
    public static deserializeTransaction(
        serialized: string,
        blockHeight: number
    ): Interfaces.ITransaction {
        Managers.configManager.setHeight(blockHeight);
        return Transactions.Deserializer.deserialize(serialized);
    }
}
