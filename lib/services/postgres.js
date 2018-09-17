'use strict'
require('dotenv').config()
const {Client} = require('pg')
const logger = require('../services/logger')

const DB_USER = process.env.DB_USER ? process.env.DB_USER : 'ark'
const DB_HOST = process.env.DB_HOST ? process.env.DB_HOST : 'localhost'
const DB_DATABASE = process.env.DB_DATABASE ? process.env.DB_DATABASE : 'ark_mainnet'
const DB_PASSWORD = process.env.DB_PASSWORD ? process.env.DB_PASSWORD : 'password'
const DB_PORT = process.env.DB_PORT ? process.env.DB_PORT : 5432

class Postgres {
  constructor () {
    const config = {
      user: DB_USER,
      host: DB_HOST,
      database: DB_DATABASE,
      password: DB_PASSWORD,
      port: DB_PORT
    }

    this.client = new Client(config)
  }

  async connect () {
    try {
      await this.client.connect()
      logger.info('Connection to the database established.')
    } catch (error) {
      logger.error(error)
    }
  }

  async close () {
    try {
      await this.client.end()
      this.client = new Client(this.config)
      logger.info('Connection to the database terminated')
    } catch (error) {
      logger.error(error)
    }
  }

  async query (query) {
    try {
      const result = await this.client.query(query)
       if (typeof result === 'undefined') {
         throw new Error('Query did not return results')
       }
       return result
    } catch (error) {
      logger.error(error)
      return null
    }
  }
}

module.exports = new Postgres()
