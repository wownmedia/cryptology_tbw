'use strict'
require('dotenv').config()
const axios = require('axios')
const logger = require('./logger')

const SERVER = `http://${process.env.NODE}:${process.env.PORT}`
const NODES = process.env.NODES ? JSON.parse(process.env.NODES) : {}

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
  
  async broadcastTransactions(transactions) {
    for(let item in NODES) {
      console.log(NODES[item])  
    }
  }
}

module.exports = new Network()
