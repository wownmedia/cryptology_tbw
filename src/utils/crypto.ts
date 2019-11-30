import {
    Identities,
    Interfaces,
    Managers,
    Transactions,
} from "@arkecosystem/crypto";

export class Crypto {
    public static getAddressFromPublicKey(
        publicKey: string,
        networkVersion: number
    ): string {
        return Identities.Address.fromPublicKey(publicKey, networkVersion);
    }

    public static deserializeTransaction(
        serialized: string,
        blockHeight: number
    ): Interfaces.ITransaction {
        Managers.configManager.setHeight(blockHeight);
        return Transactions.Deserializer.deserialize(serialized);
    }
}
