'use strict'
require('dotenv').config()
const axios = require('axios')
const logger = require('./logger')

const SERVER = `http://${process.env.NODE}:${process.env.PORT}`
const NODES = process.env.NODES ? JSON.parse(process.env.NODES) : [{host: process.env.NODE, port: process.env.PORT}]

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

  async broadcastTransactions (transactions) {
    const results = []
    for (let item in NODES) {
      if (typeof NODES[item] !== 'undefined' && NODES[item].hasOwnProperty('host') && NODES[item].hasOwnProperty('port')) {
        const node = `http://${NODES[item].host}:${NODES[item].port}`
        logger.info(`Sending ${transactions.length} transactions to ${node}.`)
        const response = await axios.post(`${node}/api/v2/transactions`, {
          transactions
        }, {
          headers: {'API-Version': 2}
        })
        results.push({node, response: response.data})
      }
    }

    return results
  }

  async getFromAPI (endPoint, params = {}) {
    try {
      const node = typeof NODES[0] !== 'undefined' && NODES[0].hasOwnProperty('host') && NODES[0].hasOwnProperty('port') ? `http://${NODES[0].host}:${NODES[0].port}` : 'http://localhost:4003'
      const response = await axios.get(`${node}${endPoint}`, {
        params,
        headers: {'API-Version': 2}
      })

      if (typeof response !== 'undefined' && response.hasOwnProperty('data')) {
        return response.data
      }
    } catch (error) {
      logger.error(error)
    }
    return null
  }
}

module.exports = new Network()
