'use strict'
require('dotenv').config()
const logger = require('../services/logger')
const Transaction = require('./transactions')
const BigNumber = require('bignumber.js')
const ARKTOSHI = Math.pow(10, 8)

const DELEGATE = process.env.DELEGATE ? process.env.DELEGATE.toLowerCase().trim() : null
const ADMIN_PAYOUT_LIST = process.env.ADMIN_PAYOUT_LIST ? JSON.parse(process.env.ADMIN_PAYOUT_LIST) : {}
const VENDORFIELD_ADMINISTRATIVE_MESSAGE = process.env.VENDORFIELD_ADMINISTRATIVE_MESSAGE ? process.env.VENDORFIELD_ADMINISTRATIVE_MESSAGE : 'Administrative Payout'
const FEES = 0.1 * ARKTOSHI
const VENDORFIELD_MESSAGE = process.env.VENDORFIELD_MESSAGE ? process.env.VENDORFIELD_MESSAGE : 'Voter Share'

class Payouts {
  constructor () {
    if (process.env.NODE_ENV === 'test') {
      const testAdmins = '{"AdWmUu1qHhFimn78KNLPfZhNKAkyD6mtH5":0.4, "Ab4ZDNapj3wPpKGs5vvubrZoMpJWbzFFMJ":0.6}'
      this.admins = JSON.parse(testAdmins)
    } else {
      this.admins = ADMIN_PAYOUT_LIST
    }
  }
  
  generatePayouts(payouts) {
    let totalAmount = new BigNumber(0)
    let totalFees = new BigNumber(0)
    
    const transactions = []
    for (const [address] of payouts) {
      logger.info(`Payout to ${address} prepared: ${payouts.get(address).div(ARKTOSHI).toFixed(8)}`)
      const recipientId = address
      const amount = new BigNumber(payouts.get(address).div(ARKTOSHI).toFixed(8)).times(ARKTOSHI).toFixed(0) // getting precision right and rounded down
      const vendorField = `${DELEGATE} - ${VENDORFIELD_MESSAGE}`
      const transaction = new Transaction(recipientId, amount, vendorField)
      totalAmount = totalAmount.plus(new BigNumber(amount))
      totalFees = totalFees.plus(FEES)
      transactions.push(transaction.createTransaction())
    }
    
    return {totalAmount, totalFees, transactions}
  }

  generateAdminPayouts (totalAmount) {
    totalAmount = new BigNumber(totalAmount)
    let payoutAmount = new BigNumber(0)
    let adminTransactions = []
    for (let admin in this.admins) {
      const share = totalAmount.times(this.admins[admin])
      const amount = new BigNumber(share.div(ARKTOSHI).toFixed(8)).times(ARKTOSHI).toFixed(0)
      const vendorField = `${DELEGATE} - ${VENDORFIELD_ADMINISTRATIVE_MESSAGE}`
      const transaction = new Transaction(admin, amount, vendorField)
      adminTransactions.push(transaction.createTransaction())

      payoutAmount = payoutAmount.plus(share)
    }

    if (payoutAmount.gt(totalAmount)) {
      logger.error('Check admin payout percentages!')
      return []
    }

    for (let item in adminTransactions) {
      const admin = adminTransactions[item].recipientId
      const amount = new BigNumber(adminTransactions[item].amount)
      logger.info(`Administrative Payout to ${admin} prepared: ${amount.div(ARKTOSHI).toFixed(8)}`)
    }
    return adminTransactions
  }
}

module.exports = new Payouts()
