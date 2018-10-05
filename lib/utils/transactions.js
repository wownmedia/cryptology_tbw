'use strict'
require('dotenv').config()
const arkecosystem = require('@arkecosystem/crypto')
const transactionBuilder = arkecosystem.transactionBuilder

const ARKTOSHI = Math.pow(10, 8)
const FEES = 0.1 * ARKTOSHI

let passphrase = process.env.SECRET ? process.env.SECRET : null
let secondPassphrase = process.env.SECOND_SECRET ? process.env.SECOND_SECRET : null
if (process.env.NODE_ENV === 'test') {
   passphrase = 'test'
   secondPassphrase = null
}

class Transactions {
  constructor (recipientId, amount, vendorField) {
    this.recipientId = recipientId
    this.amount = parseInt(amount, 10)
    this.vendorField = vendorField
  }

  createTransaction () {
    let transaction = transactionBuilder
      .transfer()
      .amount(this.amount)
      .recipientId(this.recipientId)
      .vendorField(this.vendorField)
      .fee(FEES)
      .sign(passphrase)

    if (secondPassphrase !== null) {
      transaction = transaction.secondSign(secondPassphrase)
    }

    transaction = transaction.getStruct()
    transaction.hop = 99 // see https://github.com/ArkEcosystem/ark-node/blob/33150b4434d78567386daea28ec3507b70b5c54b/modules/nodeManager.js#L606
    return transaction
  }

  registerDelegate (username, passphrase, secondPassphrase, fee) {
    let transaction = transactionBuilder
      .delegateRegistration()
      .usernameAsset(username)
      .fee(fee)
      .sign(passphrase)

    if (secondPassphrase !== null) {
      transaction = transaction.secondSign(secondPassphrase)
    }

    transaction = transaction.getStruct()
    transaction.hop = 99
    return transaction
  }

  createSignatureTransaction (passphrase, secondPassphrase, fee) {
    let transaction = transactionBuilder
      .secondSignature()
      .signatureAsset(secondPassphrase)
      .fee(fee)
      .sign(passphrase)

    transaction = transaction.getStruct()
    transaction.hop = 99
    return transaction
  }
}

module.exports = Transactions
