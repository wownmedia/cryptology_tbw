import {Payouts} from "./interfaces";
import {logger} from "./services";
import { TrueBlockWeightEngine } from "./utils";

export class TrueBlockWeight {

    public async calculate(): Promise<Payouts> {
        const trueBlockWeightEngine = new TrueBlockWeightEngine();
        return await trueBlockWeightEngine.generatePayouts();
    }

    public async payout() {
        const payouts: Payouts = await this.calculate();
        // todo payout
    }

    public async check() {
        const payouts: Payouts = await this.calculate();
        // todo show transactions
    }
}