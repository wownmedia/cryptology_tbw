import {
    Identities,
    Interfaces,
    Managers,
    Transactions,
} from "@arkecosystem/crypto";

export class Crypto {
    /**
     *
     * @param publicKey
     * @param networkVersion
     */
    public static getAddressFromPublicKey(
        publicKey: string,
        networkVersion: number
    ): string {
        return Identities.Address.fromPublicKey(publicKey, networkVersion);
    }

    /**
     *
     * @param serialized
     * @param blockHeight
     */
    public static deserializeTransaction(
        serialized: string,
        blockHeight: number
    ): Interfaces.ITransaction {
        Managers.configManager.setHeight(blockHeight);
        return Transactions.Deserializer.deserialize(serialized);
    }
}
