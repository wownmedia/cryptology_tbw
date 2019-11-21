import {Payouts} from "./interfaces";
import {logger} from "./services";
import { TrueBlockWeightEngine } from "./utils";

export class TrueBlockWeight {

    private readonly trueBlockWeightEngine: TrueBlockWeightEngine;
    private payouts: Payouts;

    constructor() {
        try {
          this.trueBlockWeightEngine = new TrueBlockWeightEngine();
        } catch (e) {
            logger.error(e.message);
            process.exit(1);
        }
    }

    public async calculate() {
        this.payouts = await this.trueBlockWeightEngine.generatePayouts();
    }

    public async payout() {
        await this.calculate();
        // todo payout
    }

    public async check() {
        await this.calculate();
        // todo show transactions
    }
}