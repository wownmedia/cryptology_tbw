'use strict'
const Transactions = require('../../lib/utils/transactions')

describe('Transactions.createTransaction', () => {
  const transaction = new Transactions()
  it('should be a function', () => {
    expect(transaction.createTransaction).toBeFunction()
  })
})
