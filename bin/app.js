#!/usr/bin/env node
'use strict'
require('dotenv').config()
const TrueBlockWeight = require('../lib/utils/trueblockweight')
const payoutBuilder = require('../lib/utils/payouts')
const network = require('../lib/services/network')
const logger = require('../lib/services/logger')
const BigNumber = require('bignumber.js')
BigNumber.config({DECIMAL_PLACES: 8, ROUNDING_MODE: BigNumber.ROUND_DOWN})

const ARKTOSHI = new BigNumber(Math.pow(10, 8))
const FEES = process.env.FEE ? new BigNumber(process.env.FEE).times(ARKTOSHI) : new BigNumber(0.1).times(ARKTOSHI)
const MAX_TRANSACTIONS_PER_REQUEST = process.env.MAX_TRANSACTIONS_PER_REQUEST ? parseInt(process.env.MAX_TRANSACTIONS_PER_REQUEST, 10) : 40

async function start () {
  try {
    const trueblockweight = new TrueBlockWeight()
    const {payouts, delegateProfit, acfDonation, timestamp} = await trueblockweight.generatePayouts()

    let {totalAmount, totalFees, transactions} = payoutBuilder.generatePayouts(payouts, timestamp)

    const adminTransactions = payoutBuilder.generateAdminPayouts(delegateProfit, timestamp)
    if (adminTransactions.length) {
      totalAmount = totalAmount.plus(delegateProfit.toFixed(0))
      totalFees = totalFees.plus(FEES.times(adminTransactions.length))
    }

    if (acfDonation.gt(0)) {
      const acfTransaction = payoutBuilder.generateAcfPayout(acfDonation, timestamp)
      totalAmount = totalAmount.plus(acfDonation.toFixed(0))
      totalFees = totalFees.plus(FEES)
      adminTransactions.push(acfTransaction)
    }

    logger.info('==================================================================================')
    logger.info(`Ready to Payout: ${totalAmount.div(ARKTOSHI).toFixed(8)} + ${totalFees.div(ARKTOSHI).toFixed(8)} fees.`)
    logger.info('==================================================================================')
    const args = process.argv.slice(2)
    if (args.length >= 1 && args[0] === 'payout') {
      logger.info('Payouts initiated')
      transactions = transactions.concat(adminTransactions)
      for (let i = 0; i < transactions.length; i += MAX_TRANSACTIONS_PER_REQUEST) {
        const transactionsChunk = transactions.slice(i, i + MAX_TRANSACTIONS_PER_REQUEST)

        try {
          const response = await network.broadcastTransactions(transactionsChunk)
          console.log(JSON.stringify(response))
        } catch (error) {
          logger.error(error.message)
        }
      }
    } else if (args.length >= 1 && args[0] === 'check') {
      logger.info('Transactions Generated')
      for (const transaction of transactions.concat(adminTransactions)) {
        console.log(JSON.stringify(transaction))
      }
    }
  } catch (error) {
    console.error(error)
  }
}

start()
