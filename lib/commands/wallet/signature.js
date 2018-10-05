'use strict'

const Joi = require('joi')
const Transaction = require('../../utils/transactions')
const crypto = new Transaction()
const network = require('../../services/network')
const input = require('../../utils/input')
const logger = require('../../services/logger')
const schema = {
  secondPassphrase: Joi.string().required(),
  passphrase: Joi.string().required(),
  fee: Joi.number().integer().min(1).optional()
}

/**
 * @dev Create a new second signature.
 * @param {string} secondSecret The second signature to create
 * @param {object} cmd A JSON object containing the options for this query (network, node, format, verbose).
 */
module.exports = async (secondPassphrase, cmd) => {
  let interactive = cmd.interactive ? cmd.interactive : false
  let passphrase = cmd.passphrase ? cmd.passphrase : false
  let fee = cmd.fee ? parseInt(cmd.fee, 10) : 500000000

  try {
    // Prompt for optional input (passphrase and second signature)
    const promptSignature = typeof (secondPassphrase) === 'undefined'
    const promptPassphrase = !cmd.passphrase || cmd.passphrase === true
    const inputResponse = await input.getPrompt(promptPassphrase, promptSignature)

    if (inputResponse.hasOwnProperty('passphrase')) {
      passphrase = inputResponse.passphrase.toString()
    }

    if (inputResponse.hasOwnProperty('signature')) {
      secondPassphrase = inputResponse.signature.toString()
    }

    // Validate input
    Joi.validate({
      secondPassphrase,
      passphrase,
      fee
    }, schema, (err) => {
      if (err) {
        throw new Error(err) // TDOD make error messages more userfriendly
      }
    })

    // Create register transaction
    const transaction = crypto.createSignatureTransaction(passphrase, secondPassphrase, fee)

    // Execute the transaction
    if (interactive) {
      // Promt to confirm transaction
      const message = `Creating second signature: ${secondPassphrase} now. Are you sure? Y(es)/N(o)`
      const confirm = await input.promptConfirmTransaction(message)
      if (!confirm) {
        throw new Error('Transaction cancelled by user.')
      }
    }

    const transactions = []
    transactions.push(transaction)
    const transactionResponse = await network.postTransaction(transactions)
    if (transactionResponse.data.success !== true) {
        throw new Error(`Could not send transactions: ${transactionResponse.data.error}`)
    }

    logger.info(transactionResponse.data.transactionIds)

    const transactionId = transactionResponse.data.transactionIds[0]
    const result = {
      'signature': secondPassphrase,
      transactionId
    }
    logger.info(JSON.stringify(result))
    return
  } catch (error) {
    logger.error(error.message)
    process.exitCode = 1
  }
}
