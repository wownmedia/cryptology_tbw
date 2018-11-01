'use strict'
require('dotenv').config()
const arkecosystem = require('@arkecosystem/crypto')
const transactionBuilder = arkecosystem.transactionBuilder
const BigNumber = require('bignumber.js')
BigNumber.config({ROUNDING_MODE : BigNumber.ROUND_DOWN})

const ARKTOSHI = Math.pow(10, 8)
const FEE = process.env.FEE ? new BigNumber(process.env.FEE).times(ARKTOSHI) : new BigNumber(0.1).times(ARKTOSHI)

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
  
  createMultiPayment(payments = []) {
    let multiPayment = transactionBuilder
      .multiPayment()
      .vendorField(this.vendorField)
      .amount(0)
      .fee(FEE)
    
    for(let item in payments) {
      if(payments[item].hasOwnProperty('address') && payments[item].hasOwnProperty('amount')) {
        const address = payments[item].address
        const amount = payments[item].amount
        multiPayment.addPayment(address, amount)
      }
    }
console.log(JSON.stringify(multiPayment))    
    multiPayment.sign(passphrase)

    if (secondPassphrase !== null) {
      multiPayment.secondSign(secondPassphrase)
    }


    multiPayment = multiPayment.getStruct()
    return multiPayment
  }

  createTransaction () {
    let transaction = transactionBuilder
      .transfer()
      .amount(this.amount)
      .recipientId(this.recipientId)
      .vendorField(this.vendorField)
      .fee(FEE)
      .sign(passphrase)

    if (secondPassphrase !== null) {
      transaction = transaction.secondSign(secondPassphrase)
    }

    transaction = transaction.getStruct()
    return transaction
  }

  createCLITransaction (amount, recipientId, vendorField, passphrase, secondPassphrase = null) {
    let transaction = transactionBuilder
      .transfer()
      .amount(amount)
      .recipientId(recipientId)
      .vendorField(vendorField)
      .fee(FEE)
      .sign(passphrase)

    if (secondPassphrase !== null) {
      transaction = transaction.secondSign(secondPassphrase)
    }

    transaction = transaction.getStruct()
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
    return transaction
  }

  createSignatureTransaction (passphrase, secondPassphrase, fee) {
    let transaction = transactionBuilder
      .secondSignature()
      .signatureAsset(secondPassphrase)
      .fee(fee)
      .sign(passphrase)

    transaction = transaction.getStruct()
    return transaction
  }
}

module.exports = Transactions
