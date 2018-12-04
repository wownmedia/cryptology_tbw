'use strict'
require('dotenv').config()
const axios = require('axios')
const logger = require('./logger')

const SERVER = `http://${process.env.NODE}:${process.env.PORT}`

class Network {
  async postTransaction (transactions) {
    logger.info(`Sending ${transactions.length} transactions to ${SERVER}.`)
    return axios.post(`${SERVER}/api/v2/transactions`, {
      transactions
    }, {
      headers: {
        'version': process.env.VERSION,
        'Content-Type': 'application/json',
        'port': process.env.PORT,
        'nethash': process.env.NETHASH
      }
    })
  }
}

module.exports = new Network()
