'use strict'
require('dotenv').config()
const axios = require('axios')
const logger = require('./logger')

const SERVER = `http://${process.env.NODE}:${process.env.PORT}`
const NETHASH = '6e84d08bd299ed97c212c886c98a57e36545c8f5d645ca7eeae63a8bd62d8988'

class Network {
  async postTransaction (transactions) {
    logger.info(`Sending ${transactions.length} transactions to ${SERVER}.`)
    return axios.post(`${SERVER}/api/v2/transactions`, {
      transactions
    }, {
      headers: {
        'API-Version': 2
      }
    })
  }
}

module.exports = new Network()
