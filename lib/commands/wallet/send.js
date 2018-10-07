'use strict'

const Joi = require('joi')
const Transaction = require('../../utils/transactions')
const crypto = new Transaction()
const network = require('../../services/network')
const input = require('../../utils/input')
const logger = require('../../services/logger')
const ARKTOSHI = Math.pow(10, 8)
const schema = {
  address: Joi.string().length(34).required(),
  smartbridge: Joi.string().max(64, 'utf8').allow('').optional(), // Change to 255 in v2
  passphrase: Joi.string().required(),
  secondSecret: Joi.string().allow('').optional(),
  amount: Joi.number().integer().min(1).required(),
  fee: Joi.number().integer().min(1).optional()
}

/**
 * @dev Send <amount> to <recepient>
 * @param {string} amount The amount to send (e.g. 1)
 * @param {recepient} address The address of the receiver of the transaction
 * @param {object} cmd A JSON object containing the options for this query (network, node, format, verbose).
 */
module.exports = async (amount, recepient, cmd) => {
  let interactive = cmd.interactive ? cmd.interactive : false
  let smartbridge = cmd.smartbridge ? cmd.smartbridge : ''
  let passphrase = cmd.passphrase ? cmd.passphrase : false
  let secondSecret = cmd.signature ? cmd.signature : null
  let fee = cmd.fee ? parseInt(cmd.fee, 10) : 10000000

  try {
    let promptPassphrase = !cmd.passphrase || cmd.passphrase === true
    let promptSignature = cmd.signature === true

    const promptSmartBridge = cmd.smartbridge === true
    const inputResponse = await input.getPrompt(promptPassphrase, promptSignature, promptSmartBridge)

    if (inputResponse.hasOwnProperty('smartbridge')) {
      smartbridge = inputResponse.smartbridge.toString()
    }

    if (inputResponse.hasOwnProperty('passphrase')) {
      passphrase = inputResponse.passphrase.toString()
    }

    if (inputResponse.hasOwnProperty('signature')) {
      secondSecret = inputResponse.signature.toString()
    }

    // Convert the amount to integer in ARK*100000000
    amount = await input.amountToARK(amount)

    // Validate input
    let _secondSecret = secondSecret === null ? '' : secondSecret
    Joi.validate({
      address: recepient,
      smartbridge,
      passphrase,
      secondSecret: _secondSecret,
      amount,
      fee
    }, schema, (err) => {
      if (err) {
        throw new Error(err) // TODO make these clear error messages
      }
    })

    const transaction = crypto.createCLITransaction(amount, recepient, smartbridge, passphrase, secondSecret)

    // Execute the transaction
    if (interactive) {
console.log(JSON.stringify(transaction))
      // Promt to confirm transaction
      const value = parseFloat(amount) / ARKTOSHI
      const message = `Sending ${network.network.config.symbol} ${value} to ${recepient} now. Are you sure? Y(es)/N(o)`
      const confirm = await input.promptConfirmTransaction(message)
      if (!confirm) {
        throw new Error('Transaction cancelled by user.')
      }
    }

    const transactions = []
    transactions.push(transaction)
    const transactionResponse = await network.postTransaction(transactions)
    if (transactionResponse.data.success !== true) {
        throw new Error(`Could not send transaction: ${transactionResponse.data.error}`)
    }

    const transactionId = transactionResponse.data.transactionIds[0]
    logger.info('==================================================================================')
    logger.info('Transaction will be forged.')
    logger.info(`TransactionId: ${transactionId}`)
    logger.info('==================================================================================')
    return
  } catch (error) {
    logger.error(error.message)
    process.exitCode = 1
  }
}
