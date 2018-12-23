'use strict'
require('dotenv').config()
const { Transaction } = require('@arkecosystem/crypto').models
const crypto = require('./crypto')
const postgres = require('../services/postgres.js')
const logger = require('../services/logger')
const queries = require('./queries.js')
const BigNumber = require('bignumber.js')
BigNumber.config({ROUNDING_MODE: BigNumber.ROUND_DOWN})

const ARKTOSHI            = new BigNumber(Math.pow(10, 8))
const BLOCK_REWARD        = new BigNumber(2).times(ARKTOSHI)
const FEE                 = process.env.FEE ? new BigNumber(process.env.FEE).times(ARKTOSHI) : new BigNumber(0.1).times(ARKTOSHI)
const NETWORK_VERSION     = process.env.NETWORK_VERSION ? process.env.NETWORK_VERSION : 23
const DELEGATE            = process.env.DELEGATE ? process.env.DELEGATE.toLowerCase().trim() : null
const PAYOUT              = process.env.PAYOUT ? new BigNumber(process.env.PAYOUT) : new BigNumber(0)
const PAYOUT_FEES         = process.env.PAYOUT_FEES ? new BigNumber(process.env.PAYOUT_FEES) : new BigNumber(0)
const PAYOUT_ACF          = process.env.PAYOUT_ACF ? new BigNumber(process.env.PAYOUT_ACF) : new BigNumber(0)
const MIN_PAYOUT_VALUE    = process.env.MIN_PAYOUT_VALUE ? new BigNumber(process.env.MIN_PAYOUT_VALUE) : new BigNumber(0.25)
const START_BLOCK_HEIGHT  = process.env.START_BLOCK_HEIGHT ? parseInt(process.env.START_BLOCK_HEIGHT, 10) : 0
const BLOCKLIST           = process.env.BLOCKLIST ? process.env.BLOCKLIST.split(',') : []
const CUSTOM_PAYOUT_LIST  = process.env.CUSTOM_PAYOUT_LIST ? JSON.parse(process.env.CUSTOM_PAYOUT_LIST) : {}
const CUSTOM_REDIRECTIONS = process.env.CUSTOM_REDIRECTIONS ? JSON.parse(process.env.CUSTOM_REDIRECTIONS) : {}
const CUSTOM_FREQUENCY    = process.env.CUSTOM_FREQUENCY ? JSON.parse(process.env.CUSTOM_FREQUENCY) : {}
const WHITELIST           = process.env.WHITELIST ? process.env.WHITELIST.split(',') : []

const DELEGATE_PAYOUT_SIGNATURE = `${DELEGATE} - `

if (DELEGATE === null) {
  logger.error('No delegate configured!')
  process.exit(1)
}

class TrueBlockWeight {
  constructor () {
    this.delegate = DELEGATE
    this.share = PAYOUT.lte(1) ? new BigNumber(PAYOUT) : new BigNumber(0)
    this.feesShare = PAYOUT_FEES.lte(1) ? new BigNumber(PAYOUT_FEES) : new BigNumber(0)
    this.acfShare = PAYOUT_ACF.lte(1) ? new BigNumber(PAYOUT_ACF) : new BigNumber(0)
    this.minPayout = MIN_PAYOUT_VALUE.times(ARKTOSHI)
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
      const acfDonation = this.acfDonation
      return {payouts, delegateProfit, acfDonation}
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
      const getForgedBlocksQuery = queries.getForgedBlocks(this.publicKey, this.startBlockHeight)
      const result = await this.psql.query(getForgedBlocksQuery)

      this.forgedBlocks = result.rows.map((block) => {
        return {
          'height': parseInt(block.height, 10),
          'fees': new BigNumber(block.totalFee),
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
          'publicKey': row.public_key,
          'balance': new BigNumber(row.balance)
        }
      })

      // Remove all blocked addresses
      const whitelisted = []
      for (let item in this.voterBalances) {
        if (this.voterBalances[item].hasOwnProperty('address')) {
          const address = this.voterBalances[item].address
          if (BLOCKLIST.indexOf(address) >= 0) {
            logger.warn(`Blacklisted address: ${address} removed from payout pool.`)
          } else if (WHITELIST.length > 0 && WHITELIST.indexOf(address) >= 0) {
            logger.warn(`Whitelisted: ${address} added to payout pool.`)
            whitelisted.push(this.voterBalances[item])
          } else if(WHITELIST.length === 0){
            whitelisted.push(this.voterBalances[item])
          }
        }
      }
      this.voterBalances = whitelisted
      this.voters = this.voterBalances.map(voterBalances => voterBalances.address)
      this.votersPublicKeys = this.voterBalances.map(voterBalances => voterBalances.publicKey)

      logger.info(`Valid voters: ${this.voters.length}`)
    } catch (error) {
      logger.error(`Error retrieving voter balances from database: ${error}`)
    }
  }

  __deserializeTransaction (transaction) {
    try {
      const buffer = Buffer.from(transaction, 'hex')
      const serialized = Buffer.from(buffer).toString('hex')
      const data = Transaction.deserialize(serialized)

      return data
    } catch (error) {
      logger.error(`Deserializing transaction: ${error.message}`)
      return null
    }
  }

  async __getVoterSinceHeight () {
    try {
      const getVoterSinceHeightQuery = queries.getVoterSinceHeight(this.votersPublicKeys)
      const result = await this.psql.query(getVoterSinceHeightQuery)

      const voteTransactions = result.rows.map(transaction => {
        const data = this.__deserializeTransaction(transaction.serialized)
        return {
          'height': parseInt(transaction.height, 10),
          'address': data.recipientId,
          'vote': data.asset.votes[0]
        }
      })

      this.voterSince = {}
      for (let item in voteTransactions) {
        if (voteTransactions[item].hasOwnProperty('vote')) {
          const vote = voteTransactions[item].vote

          if (vote.includes(`+${this.publicKey}`)) {
            const address = voteTransactions[item].address
            const height = voteTransactions[item].height
            this.voterSince[address] = height
          }
        }
      }
    } catch (error) {
      logger.error(`Error retrieving voter votes from database: ${error}`)
    }
  }

  async __getTransactions () {
    try {
      const getgetTransactionsQuery = queries.getTransactions(this.voters, this.votersPublicKeys, this.startBlockHeight, this.publicKey)
      const result = await this.psql.query(getgetTransactionsQuery)

      this.transactions = result.rows.map(transaction => {
        const data = this.__deserializeTransaction(transaction.serialized)
        const senderId = crypto.getAddressFromPublicKey(transaction.sender_public_key, NETWORK_VERSION)
        return {
          'amount': new BigNumber(transaction.amount),
          'height': parseInt(transaction.height, 10),
          'recipientId': transaction.recipient_id,
          'senderId': senderId,
          'sender_public_key': transaction.sender_public_key,
          'fee': new BigNumber(transaction.fee),
          'timestamp': transaction.timestamp,
          'delegatePayout': !!(data.vendorField && data.vendorField.includes(DELEGATE_PAYOUT_SIGNATURE) && transaction.sender_public_key === this.publicKey)
        }
      })

      logger.info(`Transactions retrieved: ${this.transactions.length}`)
     } catch (error) {
      logger.error(`Error retrieving transactions from database: ${error}`)
    }
  }

  __processBalances () {
    for (let block in this.forgedBlocks) {
      if (this.forgedBlocks[block].hasOwnProperty('height')) {
        block = parseInt(block, 10)
        const blockHeight = this.forgedBlocks[block].height
        const nextBlockHeight = this.forgedBlocks[block - 1] ? this.forgedBlocks[block - 1].height : blockHeight + 211 * 8
        this.forgedBlocks[block].voterBalances = new Map(this.voterBalances.map((voter) => [voter.address, voter.balance]))

        for (let item in this.transactions) {
          if (this.transactions[item].hasOwnProperty('height')) {
            item = parseInt(item, 10)
            const transactionHeight = parseInt(this.transactions[item].height, 10)

            if (transactionHeight >= blockHeight && transactionHeight < nextBlockHeight) {
              const recipientId = this.transactions[item].recipientId
              const senderId = this.transactions[item].senderId
              const amount = this.transactions[item].amount
              const fee = this.transactions[item].fee
              if (this.voters.indexOf(recipientId) >= 0) {
                let balance = this.forgedBlocks[block].voterBalances.get(recipientId)
                balance = balance.minus(amount)
                if (balance.lt(0)) {
                  balance = new BigNumber(0)
                }
               this.forgedBlocks[block].voterBalances.set(recipientId, balance)
              }

              if (this.voters.indexOf(senderId) >= 0) {
                let balance = this.forgedBlocks[block].voterBalances.get(senderId)
                balance = balance.plus(amount)
                balance = balance.plus(fee)
                this.forgedBlocks[block].voterBalances.set(senderId, balance)
             }
            }
          }
        }

        // Remove all balances from before a user voted
        for (const [address] of this.forgedBlocks[block].voterBalances) {
          if (this.voterSince[address] > blockHeight) {
            this.forgedBlocks[block].voterBalances.set(address, new BigNumber(0))
          }
        }
      }
    }
  }

  __generateShares () {
    this.payouts = new Map(this.voters.map((address) => [address, new BigNumber(0)]))
    this.feesPayouts = new Map(this.voters.map((address) => [address, new BigNumber(0)]))

    for (let block in this.forgedBlocks) {
      if (this.forgedBlocks[block].hasOwnProperty('voterBalances')) {
        block = parseInt(block, 10)
        const blockVoterBalances = this.forgedBlocks[block].voterBalances
        const totalRewardsThisBlock = BLOCK_REWARD

        const totalFeesThisBlock = this.forgedBlocks[block].fees
        let totalVoterBalancesThisBlock = this.__sumVoterBalancesForBlock(blockVoterBalances)
        for (const [address, balance] of blockVoterBalances) {
          if (this.latestPayouts.get(address) <= this.forgedBlocks[block].height) {
            // Process Block rewards
            let rewardShare = balance.div(totalVoterBalancesThisBlock).times(totalRewardsThisBlock)
            let pendingPayout = this.payouts.get(address).plus(rewardShare)
            this.payouts.set(address, pendingPayout)

            // Process fee rewards
            let feeShare = balance.div(totalVoterBalancesThisBlock).times(totalFeesThisBlock)
            let pendingFeesPayout = this.feesPayouts.get(address).plus(feeShare)
            this.feesPayouts.set(address, pendingFeesPayout)
          }
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
      if (this.voters[voter]) {
        const address = this.voters[voter]
        const divertedAddress = this.__getRedirectAddress(address)

        // Find the latest transaction from the delegate to this user that is marked as a payout
        for (let transaction in this.transactions) {
          if (this.transactions[transaction].recipientId === divertedAddress &&
          this.transactions[transaction].sender_public_key === this.publicKey &&
          this.transactions[transaction].delegatePayout) {
            // Find the latest block that was forged before (and included in the) payout
            const transactionTimestamp = this.transactions[transaction].height
            for (let block in this.forgedBlocks) {
              if (this.forgedBlocks[block].hasOwnProperty('height')) {
                block = parseInt(block, 10)
                const blockTimestamp = this.forgedBlocks[block].height
                const nextBlockTimestamp = this.forgedBlocks[block - 1] ? this.forgedBlocks[block - 1].height : blockTimestamp + 211 * 8
                if (transactionTimestamp >= blockTimestamp && transactionTimestamp < nextBlockTimestamp) {
                  this.latestPayouts.set(address, this.forgedBlocks[block].height)
                  break
                }
              }
            }
            break
          }
        }
      }
    }
  }

  __getRedirectAddress (address) {
    if (CUSTOM_REDIRECTIONS.hasOwnProperty(address) === true) {
      return CUSTOM_REDIRECTIONS[address]
    }
    return address
  }

  __getFrequencyAddress (address) {
    if (CUSTOM_FREQUENCY.hasOwnProperty(address) === true) {
      return CUSTOM_FREQUENCY[address]
    }
    return 0
  }

  __applyProposal () {
    let totalPayout = new BigNumber(0)
    this.delegateProfit = new BigNumber(0)
    this.acfDonation = new BigNumber(0)

    for (const [address, balance] of this.payouts) {
      if (this.__isFrequencyMinimumReached(address)) {
        // Percentages
        const percentage = this.__getSharePercentage(address)
        this.payouts.set(address, balance.times(percentage))
        this.delegateProfit = this.delegateProfit.plus(balance.times(new BigNumber(1).minus(percentage).minus(this.acfShare)))
        this.acfDonation = this.acfDonation.plus(balance.times(this.acfShare))
      }
    }

    for (const [address, balance] of this.feesPayouts) {
      if(this.__isFrequencyMinimumReached(address)) {
        // Percentages
        this.feesPayouts.set(address, balance.times(this.feesShare))
        this.delegateProfit = this.delegateProfit.plus(balance.times(new BigNumber(1).minus(this.feesShare)))

        // Remove anything under minimum payout value
        const payout = this.payouts.get(address).plus(this.feesPayouts.get(address))
        this.payouts.set(address, payout)
        if (this.payouts.get(address).lt(this.minPayout)) {
          logger.warn(`Payout to ${address} pending (min. value ${this.minPayout.div(ARKTOSHI).toNumber()}): ${this.payouts.get(address).div(ARKTOSHI).toFixed(8)}`)
          this.payouts.delete(address)
        } else {
          totalPayout = totalPayout.plus(this.payouts.get(address))
        }
      }
    }

    // FairFees
    const totalFees = FEE.times(this.payouts.size + this.__getAdminFeeCount() + this.__getACFFeeCount())
    for (const [address, balance] of this.payouts) {
      const fairFees = balance.div(totalPayout).times(totalFees)
      this.payouts.set(address, balance.minus(fairFees))
    }

    logger.info('==================================================================================')
    logger.info(`Next payout run: ${this.payouts.size} payouts with total amount: ${totalPayout.div(ARKTOSHI).toFixed(8)} including fees ${totalFees.div(ARKTOSHI).toFixed(8)}`)
    logger.info(`Delegate Profits: ${this.delegateProfit.div(ARKTOSHI).toFixed(8)}`)
    logger.info(`ACF Donation: ${this.acfDonation.div(ARKTOSHI).toFixed(8)}`)
    logger.info('==================================================================================')
  }

  __getSharePercentage (address) {
    if (CUSTOM_PAYOUT_LIST.hasOwnProperty(address) === true) {
      logger.info(`Custom share percentage found for ${address}: ${new BigNumber(CUSTOM_PAYOUT_LIST[address]).times(100).toString()}%`)
      const customShare = new BigNumber(CUSTOM_PAYOUT_LIST[address])
      if (customShare.plus(this.acfShare).gt(1)) {
        logger.warn(`Custom share percentage for ${address} is larger than 100%: percentage has been capped at 100%`)
        return customShare.minus(this.acfShare).toNumber()
      }
      if (customShare.lt(0)) {
        logger.warn(`Custom share percentage for ${address} is smaller than 0%: percentage has been capped at 0%`)
        return 0
      }
      return customShare
    }
    return this.share
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

  __getACFFeeCount () {
    if (this.acfShare.gt(0)) {
      return 1
    }

    return 0
  }

  /*
    Returns true if no custom frequency is set, the address hasn't yet received a disbursement,
    or the current block has now passed the custom minimum threshold. Returns false otherwise.
  */
  __isFrequencyMinimumReached (address) {
    const frequency = this.__getFrequencyAddress(address)
    const lastPayoutHeight = this.latestPayouts.get(address)

    if (!lastPayoutHeight || !frequency) {
      return true;
    }

    const blockMinimums = lastPayoutHeight + frequency
    const currentBlock = this.forgedBlocks[0].height
    if (blockMinimums < currentBlock) {
      return true;
    }

    logger.warn(`Payout to ${address} pending (delay of ${frequency} blocks not yet reached) [${blockMinimums}/${currentBlock}]`)
    this.payouts.delete(address)
    return false;
  }
}

module.exports = TrueBlockWeight
