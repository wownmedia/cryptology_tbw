"use strict";
const payouts = require("../../src/utils/payouts");
const BigNumber = require("bignumber.js");
BigNumber.config({
    DECIMAL_PLACES: 8,
    ERRORS: false,
});

describe("payouts.generatePayouts", () => {
    it("should be a function", () => {
        expect(payouts.generatePayouts).toBeFunction();
    });
});

describe("payouts.generateAdminPayouts", () => {
    it("should be a function", () => {
        expect(payouts.generateAdminPayouts).toBeFunction();
    });

    it("should return ...", () => {
        const delegateProfit = new BigNumber(100000000);
        const results = payouts.generateAdminPayouts(delegateProfit);
        expect(results).toBeArray();
    });
});
