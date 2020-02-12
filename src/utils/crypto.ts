import {
    Identities,
    Interfaces,
    Managers,
    Transactions,
} from "@arkecosystem/crypto";
import ByteBuffer from "bytebuffer";
import { BigNumber } from "@arkecosystem/utils";

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

    public static deserializeMagistrateTransaction(
        serialized: string
    ): Interfaces.ITransaction {
        const transaction = {} as Interfaces.ITransaction;
        transaction.data = {} as Interfaces.ITransactionData;

        transaction.hasVendorField = () => { return false };

        const buffer: ByteBuffer = this.getByteBuffer(serialized);
        buffer.skip(1); // Skip 0xFF marker
        transaction.data.version = buffer.readUint8();
        transaction.data.network = buffer.readUint8();

        if (transaction.data.version === 1) {
            transaction.data.type = buffer.readUint8();
            transaction.data.timestamp = buffer.readUint32();
        } else {
            transaction.data.typeGroup = buffer.readUint32();
            transaction.data.type = buffer.readUint16();
            transaction.data.nonce = BigNumber.make(buffer.readUint64().toString());
        }

        transaction.data.senderPublicKey = buffer.readBytes(33).toString("hex");
        transaction.data.fee = BigNumber.make(buffer.readUint64().toString());
        transaction.data.amount = BigNumber.ZERO;
        return transaction.data.fee.isGreaterThan(0) ? transaction : null;
    }

    public static getPublicKeyFromSeed(seed: string): string {
        return Identities.PublicKey.fromPassphrase(seed);
    }

    private static getByteBuffer(serialized: Buffer | string): ByteBuffer {
        if (!(serialized instanceof Buffer)) {
            serialized = Buffer.from(serialized, "hex");
        }

        const buffer: ByteBuffer = new ByteBuffer(serialized.length, true);
        buffer.append(serialized);
        buffer.reset();

        return buffer;
    }
}
