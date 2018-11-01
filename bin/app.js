#!/usr/bin/env node
'use strict'
require('dotenv').config()
const TrueBlockWeight = require('../lib/utils/trueblockweight')
const payoutBuilder = require('../lib/utils/payouts')
const network = require('../lib/services/network')
const logger = require('../lib/services/logger')
const BigNumber = require('bignumber.js')
BigNumber.config({ROUNDING_MODE : BigNumber.ROUND_DOWN})

const ARKTOSHI = new BigNumber(Math.pow(10, 8))
const FEES = new BigNumber(0.1).times(ARKTOSHI)

async function start () {
  try {
    const trueblockweight = new TrueBlockWeight()
    const {payouts, delegateProfit, acfDonation} = await trueblockweight.generatePayouts()

    let {totalAmount, totalFees, transactions} = payoutBuilder.generatePayouts(payouts)

    const adminTransactions = payoutBuilder.generateAdminPayouts(delegateProfit)
    if (adminTransactions.length) {
      totalAmount = totalAmount.plus(delegateProfit.toFixed(0))
      totalFees = totalFees.plus(FEES.times(adminTransactions.length))
    }

    if (acfDonation.gt(0)) {
      const acfTransaction = payoutBuilder.generateAcfPayout(acfDonation)
      totalAmount = totalAmount.plus(acfDonation.toFixed(0))
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
    } else if (args.length >= 1 && args[0] === 'check') {
      logger.info('Transactions Generated')
      transactions.concat(adminTransactions)
      for(const transaction of transactions) {
        console.log(JSON.stringify(transaction))
      }
    }
  } catch (error) {
    console.error(error)
  }
}

start()
