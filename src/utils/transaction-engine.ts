import { Interfaces, Managers, Transactions } from "@arkecosystem/crypto";
import { MultiPaymentBuilder } from "@arkecosystem/crypto/dist/transactions/builders/transactions/multi-payment";
import { TransferBuilder } from "@arkecosystem/crypto/dist/transactions/builders/transactions/transfer";
import BigNumber from "bignumber.js";
import { Receiver } from "../interfaces";
import { Config, logger, Network } from "../services";

export class TransactionEngine {
    private readonly config: Config;
    private readonly network: Network;
    private nonce: number = null;

    constructor() {
        BigNumber.config({
            DECIMAL_PLACES: 8,
            ROUNDING_MODE: BigNumber.ROUND_DOWN,
        });

        try {
            this.config = new Config();
            this.network = new Network(this.config.server, this.config.nodes);
        } catch (e) {
            logger.error(e.message);
            process.exit(1);
        }
    }

    /**
     *
     * @param receivers
     * @param timestamp
     */
    public async createMultiPayment(
        receivers: Receiver[],
        timestamp: number
    ): Promise<Interfaces.ITransactionData[]> {
        await this.setupNetwork();
        const transactions: Interfaces.ITransactionData[] = [];
        const vendorField: string = `${this.config.delegate} - ${this.config.vendorField}`;

        for (
            let i = 0;
            i < receivers.length;
            i += this.config.transactionsPerMultitransfer
        ) {
            const chunk: Receiver[] = receivers.slice(
                i,
                i + this.config.transactionsPerMultitransfer
            );
            this.nonce += 1;
            let transaction: MultiPaymentBuilder = Transactions.BuilderFactory.multiPayment()
                .vendorField(vendorField)
                .fee(this.config.multiTransferFee.toFixed(0))
                .nonce(this.nonce.toString());
            for (const receiver of chunk) {
                transaction.addPayment(
                    receiver.wallet,
                    receiver.amount.toFixed(0)
                );
            }
            if (timestamp) {
                transaction.data.timestamp = timestamp;
            }

            transaction = transaction.sign(this.config.seed);

            if (this.config.secondPassphrase !== null) {
                transaction = transaction.secondSign(
                    this.config.secondPassphrase
                );
            }
            transactions.push(transaction.getStruct());
        }
        return transactions;
    }

    /**
     *
     * @param receiver
     * @param timestamp
     */
    public async createTransaction(
        receiver: Receiver,
        timestamp: number
    ): Promise<Interfaces.ITransactionData> {
        await this.setupNetwork();
        this.nonce += 1;

        let transaction: TransferBuilder = Transactions.BuilderFactory.transfer()
            .amount(receiver.amount.toFixed(0))
            .recipientId(receiver.wallet)
            .vendorField(receiver.vendorField)
            .fee(this.config.transferFee.toFixed(0))
            .nonce(this.nonce.toString());

        // todo somehow it doesn't take it as 255 from the setConfig with ARK mainnet
        if (
            Buffer.from(receiver.vendorField).length > 64 &&
            Buffer.from(receiver.vendorField).length <= 255
        ) {
            transaction.data.vendorField = this.config.vendorField;
        }

        if (timestamp) {
            transaction.data.timestamp = timestamp;
        }

        transaction = transaction.sign(this.config.seed);

        if (this.config.secondPassphrase !== null) {
            transaction = transaction.secondSign(this.config.secondPassphrase);
        }

        return transaction.getStruct();
    }

    /**
     *
     */
    private async setupNetwork() {
        const networkConfig: Interfaces.INetworkConfig = await this.network.getNetworkConfig();
        if (networkConfig !== null) {
            Managers.configManager.setConfig(networkConfig);
        }

        Managers.configManager.setHeight(this.config.startFromBlockHeight);

        if (this.nonce === null) {
            this.nonce = await this.network.getNonceForDelegate(
                this.config.delegate
            );
        }
    }
}
