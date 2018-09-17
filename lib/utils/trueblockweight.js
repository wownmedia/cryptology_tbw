'use strict'
require('dotenv').config()
const postgres = require('../services/postgres.js')
const logger = require('../services/logger')
const queries = require('./queries.js')
const BigNumber = require('bignumber.js')

const ARKTOSHI = Math.pow(10, 8)
const BLOCK_REWARD = 2 * ARKTOSHI
const FEES = 0.1 * ARKTOSHI

const DELEGATE = process.env.DELEGATE ? process.env.DELEGATE.toLowerCase().trim() : 'cryptology'
const DELEGATE_PAYOUT_SIGNATURE = `${DELEGATE} - `
const PAYOUT = process.env.PAYOUT ? new BigNumber(process.env.PAYOUT) : new BigNumber(0)
const MIN_PAYOUT_VALUE = process.env.MIN_PAYOUT_VALUE ? new BigNumber(process.env.MIN_PAYOUT_VALUE) : new BigNumber(0.25)
const START_BLOCK_HEIGHT = process.env.START_BLOCK_HEIGHT ? parseInt(process.env.START_BLOCK_HEIGHT, 10) : 0
const BLOCKLIST = process.env.BLOCKLIST ? process.env.BLOCKLIST.split(',') : []

class TrueBlockWeight {
  constructor () {
    this.delegate = DELEGATE
    this.share = PAYOUT <= 1 ? PAYOUT : new BigNumber(0)
    this.minPayout = MIN_PAYOUT_VALUE.times(ARKTOSHI)// .plus(FEES)
    this.startBlockHeight = START_BLOCK_HEIGHT
    this.psql = postgres
  }

  async generatePayouts () {
    try {
      await this.psql.connect()
      await this.__getDelegate()
      await this.__getForgedBlocks()
      await this.__getVoterBalances()
      await this.__getVoterSinceHeight()
      await this.__getTransactions()
      await this.psql.close()
      this.__findLatestPayouts()
      this.__processBalances()
      this.__generateShares()
      this.__applyProposal()

      const payouts = this.payouts
      const delegateProfit = this.delegateProfit
      return {payouts, delegateProfit}
    } catch (error) {
      logger.error(error)
      return null
    }
  }

  async __getDelegate () {
    try {
      const getDelegateQuery = queries.getDelegate(this.delegate)
      const result = await this.psql.query(getDelegateQuery)

      this.address = result.rows[0].address ? result.rows[0].address : null
      this.publicKey = result.rows[0].publicKey ? result.rows[0].publicKey : null
      this.producedblocks = result.rows[0].producedblocks ? result.rows[0].producedblocks : 0

      if (this.address === null || this.publicKey === null) {
        throw new Error('Could not retrieve delegate data.')
      }
      logger.info(`Delegate found: ${this.address}`)
    } catch (error) {
      logger.error(`Error retrieving delegate from database: ${error}`)
    }
  }

  async __getForgedBlocks () {
    try {
      const getForgedBlocksQuery = queries.getForgedBlocks(this.publicKey, this.startBlockHeight, this.producedblocks)
      const result = await this.psql.query(getForgedBlocksQuery)

      this.forgedBlocks = result.rows.map((block) => {
        return {
          'height': parseInt(block.height, 10),
          'fees': parseInt(block.totalFee, 10),
          'timestamp': block.timestamp
        }
      })

      logger.info(`Forged blocks retrieved: ${JSON.stringify(this.forgedBlocks.length)} (${this.forgedBlocks[0].height} - ${this.forgedBlocks[this.forgedBlocks.length - 1].height})`)
    } catch (error) {
      logger.error(`Error retrieving forged blocks from database: ${error}`)
    }
  }

  async __getVoterBalances () {
    try {
      const getVoterBalancesQuery = queries.getVoterBalances(this.publicKey)
      const result = await this.psql.query(getVoterBalancesQuery)

      this.voterBalances = result.rows.map((row) => {
        return {
          'address': row.address,
          'balance': parseInt(row.balance, 10)
        }
      })
      
      // Remove all blocked addresses
      for(let item in this.voterBalances) {
        const address =  this.voterBalances[item].address
        if (BLOCKLIST.indexOf(address) >= 0) {
          this.voterBalances.splice(item, 1)
        }
      }

      this.voters = this.voterBalances.map(voterBalances => voterBalances.address)

      logger.info(`Valid voters: ${this.voters.length}`)
    } catch (error) {
      logger.error(`Error retrieving voter balances from database: ${error}`)
    }
  }

  async __getVoterSinceHeight () {
    try {
      const getVoterSinceHeightQuery = queries.getVoterSinceHeight(this.voters)
      const result = await this.psql.query(getVoterSinceHeightQuery)

      const voteTransactions = result.rows.map(tx => {
        return {
          'height': parseInt(tx.height, 10),
          'address': tx.senderId,
          'vote': JSON.parse(tx.rawasset).votes[0]
        }
      })

      this.voterSince = {}
      for (let item in voteTransactions) {
        const vote = voteTransactions[item].vote

        if (vote.includes(`+${this.publicKey}`)) {
          const address = voteTransactions[item].address
          const height = voteTransactions[item].height
          this.voterSince[address] = height
        }
      }
    } catch (error) {
      logger.error(`Error retrieving voter votes from database: ${error}`)
    }
  }

  async __getTransactions () {
    try {
      const getgetTransactionsQuery = queries.getTransactions(this.voters, this.startBlockHeight)
      const result = await this.psql.query(getgetTransactionsQuery)

      this.transactions = result.rows.map(transaction => {
        return {
          'amount': parseInt(transaction.amount, 10),
          'height': parseInt(transaction.height, 10),
          'recipientId': transaction.recipientId,
          'senderId': transaction.senderId,
          'fee': parseInt(transaction.fee, 10),
          'timestamp': transaction.timestamp,
          'delegatePayout': !!(transaction.vendorField && transaction.vendorField.includes(DELEGATE_PAYOUT_SIGNATURE) && transaction.senderId === this.address)
        }
      })

      logger.info(`Transactions retrieved: ${this.transactions.length}`)
     } catch (error) {
      logger.error(`Error retrieving transactions from database: ${error}`)
    }
  }

  __processBalances () {
    for (let block in this.forgedBlocks) {
      block = parseInt(block, 10)
      const blockHeight = this.forgedBlocks[block].height
      const nextBlockHeight = this.forgedBlocks[block - 1] ? this.forgedBlocks[block - 1].height : blockHeight + (211 * 8)
      this.forgedBlocks[block].voterBalances = new Map(this.voterBalances.map((voter) => [voter.address, voter.balance]))

      for (let item in this.transactions) {
        item = parseInt(item, 10)
        const transactionHeight = parseInt(this.transactions[item].height, 10)

        if (transactionHeight >= blockHeight && transactionHeight < nextBlockHeight) {
          const recipientId = this.transactions[item].recipientId
          const senderId = this.transactions[item].senderId
          const amount = parseInt(this.transactions[item].amount, 10)
          const fee = parseInt(this.transactions[item].fee, 10)

          if (this.voters.indexOf(recipientId) >= 0) {
            let balance = this.forgedBlocks[block].voterBalances.get(recipientId)
            balance -= amount
            if (balance < 0) {
              balance = 0
            }
            this.forgedBlocks[block].voterBalances.set(recipientId, balance)
          }

          if (this.voters.indexOf(senderId) >= 0) {
            let balance = this.forgedBlocks[block].voterBalances.get(senderId)
            balance += amount
            balance += fee
            this.forgedBlocks[block].voterBalances.set(senderId, balance)
          }
        }
      }

      // Remove all balances from before a user voted
      for (const [address] of this.forgedBlocks[block].voterBalances) {
        if (this.voterSince[address] > blockHeight) {
          this.forgedBlocks[block].voterBalances.set(address, 0)
        }
      }
    }
  }

  __generateShares () {
    this.payouts = new Map(this.voters.map((address) => [address, new BigNumber(0)]))

    for (let block in this.forgedBlocks) {
      block = parseInt(block, 10)
      const blockVoterBalances = this.forgedBlocks[block].voterBalances
      const totalPayoutThisBlock = new BigNumber(this.forgedBlocks[block].fees + BLOCK_REWARD)
      let totalVoterBalancesThisBlock = this.__sumVoterBalancesForBlock(blockVoterBalances)

      for (const [address, balance] of blockVoterBalances) {
        let share = new BigNumber(balance).div(totalVoterBalancesThisBlock).times(totalPayoutThisBlock)

        if (this.latestPayouts.get(address) <= this.forgedBlocks[block].height) {
          let pendingPayout = this.payouts.get(address).plus(share)
          this.payouts.set(address, pendingPayout)
        }
      }
    }
  }

  /**
   * @dev Determine which forged block has been payout to each user last
   **/
  __findLatestPayouts () {
    this.latestPayouts = new Map(this.voters.map((address) => [address, 0]))

    // Determine the latest payout for each voter:
    for (let voter in this.voters) {
      const address = this.voters[voter]

      // Find the latest transaction from the delegate to this user that is marked as a payout
      for (let transaction in this.transactions) {
        if (this.transactions[transaction].recipientId === address &&
        this.transactions[transaction].senderId === this.address &&
        this.transactions[transaction].delegatePayout) {
          // Find the latest block that was forged before (and included in the) payout
          const transactionTimestamp = this.transactions[transaction].height
          for (let block in this.forgedBlocks) {
            block = parseInt(block, 10)
            const blockTimestamp = this.forgedBlocks[block].height
            const nextBlockTimestamp = this.forgedBlocks[block - 1] ? this.forgedBlocks[block - 1].height : blockTimestamp + (211 * 8)
            if (transactionTimestamp >= blockTimestamp && transactionTimestamp < nextBlockTimestamp) {
              this.latestPayouts.set(address, this.forgedBlocks[block].height)
              break
            }
          }
          break
        }
      }
    }
  }

  __applyProposal () {
    let totalPayout = new BigNumber(0)
    this.delegateProfit = new BigNumber(0)

    for (const [address, balance] of this.payouts) {
      // Blacklists
      // TODO if address isBlacklisted()

      // Percentages
      this.payouts.set(address, balance.times(this.share))
      this.delegateProfit = this.delegateProfit.plus(balance.times(new BigNumber(1).minus(this.share)))

      // Remove anything under minimum payout value
      if (this.payouts.get(address).lt(this.minPayout)) {
        logger.warn(`Payout to ${address} pending (min. value ${this.minPayout.div(ARKTOSHI).toNumber()}): ${this.payouts.get(address).div(ARKTOSHI).toFixed(8)}`)
        this.payouts.delete(address)
      } else {
        totalPayout = totalPayout.plus(this.payouts.get(address))
      }
    }

    const totalFees = new BigNumber(FEES).times(this.payouts.size + this.__getAdminFeeCount())
    logger.info('==================================================================================')
    logger.info(`Next payout run: ${this.payouts.size} payouts with total amount: ${totalPayout.div(ARKTOSHI).toFixed(8)} and fees ${totalFees.div(ARKTOSHI).toFixed(1)}`)
    logger.info(`Delegate Profits: ${this.delegateProfit.div(ARKTOSHI).toFixed(8)}`)
    logger.info('==================================================================================')

    // FairFees
    for (const [address, balance] of this.payouts) {
      const fairFees = balance.div(totalPayout).times(totalFees)
      this.payouts.set(address, balance.minus(fairFees))
    }
  }

  __sumVoterBalancesForBlock (blockVoterBalances) {
    let totalVoterBalancesThisBlock = new BigNumber(0)

    for (const [address] of blockVoterBalances) {
      const balance = new BigNumber(blockVoterBalances.get(address))
      totalVoterBalancesThisBlock = totalVoterBalancesThisBlock.plus(balance)
    }

    return totalVoterBalancesThisBlock
  }

  __getAdminFeeCount () {
    const ADMIN_PAYOUT_LIST = process.env.ADMIN_PAYOUT_LIST ? JSON.parse(process.env.ADMIN_PAYOUT_LIST) : {}
    return Object.keys(ADMIN_PAYOUT_LIST).length
  }
}

module.exports = TrueBlockWeight
