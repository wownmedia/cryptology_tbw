#!/usr/bin/env node
'use strict'
require('dotenv').config()
const TrueBlockWeight = require('../lib/utils/trueblockweight')
const payoutBuilder = require('../lib/utils/payouts')
const network = require('../lib/services/network')
const logger = require('../lib/services/logger')
const BigNumber = require('bignumber.js')

const ARKTOSHI = new BigNumber(Math.pow(10, 8))
const FEES = new BigNumber(0.1).times(ARKTOSHI)

async function start () {
  try {
    const trueblockweight = new TrueBlockWeight()
    const {payouts, delegateProfit, acfDonation} = await trueblockweight.generatePayouts()

    let {totalAmount, totalFees, transactions} = payoutBuilder.generatePayouts(payouts)

    const amount = new BigNumber(delegateProfit.div(ARKTOSHI).toFixed(8)).times(ARKTOSHI).toFixed(0)
console.log(`DELEGATE PROFITS: ${delegateProfit.toString()} vs ${amount}`)
    const adminTransactions = payoutBuilder.generateAdminPayouts(amount)
    if (adminTransactions.length) {
      totalAmount = totalAmount.plus(amount)
      totalFees = totalFees.plus(FEES * adminTransactions.length)
    }

    if (acfDonation.gt(0)) {
      const acfAmount = new BigNumber(acfDonation.div(ARKTOSHI).toFixed(8)).times(ARKTOSHI).toFixed(0)
      const acfTransaction = payoutBuilder.generateAcfPayout(acfAmount)
      totalAmount = totalAmount.plus(acfAmount)
      totalFees = totalFees.plus(FEES)
      adminTransactions.push(acfTransaction)
    }

    logger.info('==================================================================================')
    logger.info(`Ready to Payout: ${totalAmount.div(ARKTOSHI).toFixed(8)} + ${totalFees.div(ARKTOSHI).toFixed(1)} fees.`)
    logger.info('==================================================================================')
    const args = process.argv.slice(2)
    if (args.length >= 1 && args[0] === 'payout') {
      logger.info('Payouts initiated')
      const results = await network.postTransaction(transactions.concat(adminTransactions))
      if (results.data.success !== true) {
        throw new Error(`Could not send transactions: ${results.data.error}`)
      }
      logger.info(results.data.transactionIds)
    }
  } catch (error) {
    console.error(error)
  }
}

start()
