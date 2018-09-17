'use strict'
const payouts = require('../../lib/utils/payouts')
const BigNumber = require('bignumber.js')
BigNumber.config({
  DECIMAL_PLACES: 8,
  ERRORS: false
})

describe('payouts.generateAdminPayouts', () => {
  it('should be a function', () => {
    expect(payouts.generateAdminPayouts).toBeFunction()
  })

  it('should return ...', () => {
    const delegateProfit = new BigNumber(100000000)
    const results = payouts.generateAdminPayouts(delegateProfit)
    expect(results).toBeArray()
  })
})
