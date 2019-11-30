"use strict";
const Transactions = require("../../src/utils/transactions");

describe("Transactions.createTransaction", () => {
    const transaction = new Transactions();
    it("should be a function", () => {
        expect(transaction.createTransaction).toBeFunction();
    });
});
