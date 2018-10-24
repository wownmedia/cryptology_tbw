'use strict'
require('dotenv').config()
const logger = require('../services/logger')
const Transaction = require('./transactions')
const BigNumber = require('bignumber.js')
BigNumber.config({ROUNDING_MODE : BigNumber.ROUND_DOWN})

const ARKTOSHI = new BigNumber(Math.pow(10, 8))
const FEES = new BigNumber(0.1).times(ARKTOSHI)

const DELEGATE = process.env.DELEGATE ? process.env.DELEGATE.toLowerCase().trim() : null
const ADMIN_PAYOUT_LIST = process.env.ADMIN_PAYOUT_LIST ? JSON.parse(process.env.ADMIN_PAYOUT_LIST) : {}
const VENDORFIELD_ADMINISTRATIVE_MESSAGE = process.env.VENDORFIELD_ADMINISTRATIVE_MESSAGE ? process.env.VENDORFIELD_ADMINISTRATIVE_MESSAGE : 'Administrative Payout'
const VENDORFIELD_MESSAGE = process.env.VENDORFIELD_MESSAGE ? process.env.VENDORFIELD_MESSAGE : 'Voter Share'
const VENDORFIELD_ACF_MESSAGE = process.env.VENDORFIELD_ACF_MESSAGE ? process.env.VENDORFIELD_ACF_MESSAGE : 'ACF Donation'
const ACF = process.env.ACF ? process.env.ACF : 'AWkBFnqvCF4jhqPSdE2HBPJiwaf67tgfGR'
const CUSTOM_REDIRECTIONS = process.env.CUSTOM_REDIRECTIONS ? JSON.parse(process.env.CUSTOM_REDIRECTIONS) : {}

class Payouts {
  constructor () {
    if (process.env.NODE_ENV === 'test') {
      const testAdmins = '{"AdWmUu1qHhFimn78KNLPfZhNKAkyD6mtH5":0.4, "Ab4ZDNapj3wPpKGs5vvubrZoMpJWbzFFMJ":0.6}'
      this.admins = JSON.parse(testAdmins)
    } else {
      this.admins = ADMIN_PAYOUT_LIST
    }
  }

  generatePayouts (payouts) {
    let totalAmount = new BigNumber(0)
    let totalFees = new BigNumber(0)

    const transactions = []
    for (const [address] of payouts) {
      const recipientId = this.__getRedirectAddress(address)
      logger.info(`Payout to ${recipientId} prepared: ${payouts.get(address).div(ARKTOSHI).toFixed(8)}`)
      const amount = this.__convertAmount(payouts.get(address))
      const vendorField = `${DELEGATE} - ${VENDORFIELD_MESSAGE}`
      const transaction = new Transaction(recipientId, amount, vendorField)
      totalAmount = totalAmount.plus(new BigNumber(amount))
      totalFees = totalFees.plus(FEES)
      transactions.push(transaction.createTransaction())
    }

    return {totalAmount, totalFees, transactions}
  }

  __getRedirectAddress (address) {
    if (CUSTOM_REDIRECTIONS.hasOwnProperty(address) === true) {
      logger.info(`Redirection found for ${address}: ${CUSTOM_REDIRECTIONS[address]}`)
      return CUSTOM_REDIRECTIONS[address]
    }
    return address
  }

  generateAdminPayouts (totalAmount) {
    let payoutAmount = new BigNumber(0)
    let adminTransactions = []
    for (let admin in this.admins) {
      const share = totalAmount.times(this.admins[admin].percentage)
      const amount = this.__convertAmount(share)
      const customVendorField = this.admins[admin].vendorField ? this.admins[admin].vendorField : VENDORFIELD_ADMINISTRATIVE_MESSAGE
      const vendorField = `${DELEGATE} - ${customVendorField}`
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

  generateAcfPayout (amount) {
    amount = new BigNumber(amount)
    logger.info(`Donation Payout to ACF prepared: ${amount.div(ARKTOSHI).toFixed(8)}`)
    amount = this.__convertAmount(amount)
    const vendorField = `${DELEGATE} - ${VENDORFIELD_ACF_MESSAGE}`
    const transaction = new Transaction(ACF, amount, vendorField)

    return transaction.createTransaction()
  }

  __convertAmount (amount) {
    return amount.toFixed(0)
  }
}

module.exports = new Payouts()
