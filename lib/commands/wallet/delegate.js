'use strict'

const Joi = require('joi')
const Transaction = require('../../utils/transactions')
const crypto = new Transaction()
const network = require('../../services/network')
const input = require('../../utils/input')
const logger = require('../../services/logger')
const schema = {
  username: Joi.string().required(),
  passphrase: Joi.string().required(),
  secondSecret: Joi.string().allow('').optional(),
  fee: Joi.number().integer().min(1).optional()
}

/**
 * @dev Register wallet as delegate with <username>.
 * @param {string} username The delegate username to register
 * @param {object} cmd A JSON object containing the options for this query (network, node, format, verbose).
 */
module.exports = async (username, cmd) => {
  let interactive = cmd.interactive ? cmd.interactive : false
  let passphrase = cmd.passphrase ? cmd.passphrase : false
  let secondSecret = cmd.signature ? cmd.signature : null
  let fee = cmd.fee ? parseInt(cmd.fee, 10) : 2500000000

  

  try {
    
    let promptPassphrase, promptSignature
    // Prompt for optional input (passphrase and SmartBridge)
    promptPassphrase = !cmd.passphrase || cmd.passphrase === true
    promptSignature = cmd.signature === true

    // Prompt for optional input (passphrase and SmartBridge)
    const inputResponse = await input.getPrompt(promptPassphrase, promptSignature)

    if (inputResponse.hasOwnProperty('passphrase')) {
      passphrase = inputResponse.passphrase.toString()
    }

    if (inputResponse.hasOwnProperty('signature')) {
      secondSecret = inputResponse.signature.toString()
    }

    // Validate input
    let _secondSecret = secondSecret === null ? '' : secondSecret
    Joi.validate({
      username,
      passphrase,
      secondSecret: _secondSecret,
      fee
    }, schema, (err) => {
      if (err) {
        throw new Error(err) // TDOD make error messages more userfriendly
      }
    })

    

    // Create register transaction
    const transaction = crypto.registerDelegate(username, passphrase, secondSecret, fee)
    
    console.log(transaction)

    // Execute the transaction
    if (interactive) {
      // Promt to confirm transaction
      const message = `Registering delegate with username: ${username} now. Are you sure? Y(es)/N(o)`
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
    logger.info(`Delegate ${username} will be registered.`)
    logger.info(`TransactionId: ${transactionId}`)
    logger.info('==================================================================================')
    return
  } catch (error) {
    logger.error(error.message)
    process.exitCode = 1
  }
}
