'use strict'
require('dotenv').config()
const { Transaction } = require('@arkecosystem/crypto').models
const crypto = require('./crypto')
const postgres = require('../services/postgres.js')
const logger = require('../services/logger')
const queries = require('./queries.js')
const BigNumber = require('bignumber.js')
BigNumber.config({DECIMAL_PLACES: 12, ROUNDING_MODE: BigNumber.ROUND_DOWN})

const ARKTOSHI = new BigNumber(Math.pow(10, 8))
const BLOCK_REWARD = process.env.BLOCK_REWARD ? new BigNumber(process.env.BLOCK_REWARD).times(ARKTOSHI) : new BigNumber(2).times(ARKTOSHI)
const FEE = process.env.FEE ? new BigNumber(process.env.FEE).times(ARKTOSHI) : new BigNumber(0.1).times(ARKTOSHI)
const NETWORK_VERSION = process.env.NETWORK_VERSION ? process.env.NETWORK_VERSION : 23
const DELEGATE = process.env.DELEGATE ? process.env.DELEGATE.toLowerCase().trim() : null
const PAYOUT = process.env.PAYOUT ? new BigNumber(process.env.PAYOUT) : new BigNumber(0)
const PAYOUT_FEES = process.env.PAYOUT_FEES ? new BigNumber(process.env.PAYOUT_FEES) : new BigNumber(0)
const PAYOUT_ACF = process.env.PAYOUT_ACF ? new BigNumber(process.env.PAYOUT_ACF) : new BigNumber(0)
const MIN_PAYOUT_VALUE = process.env.MIN_PAYOUT_VALUE ? new BigNumber(process.env.MIN_PAYOUT_VALUE) : new BigNumber(0.25)
const START_BLOCK_HEIGHT = process.env.START_BLOCK_HEIGHT ? parseInt(process.env.START_BLOCK_HEIGHT, 10) : 0
const BLOCKLIST = process.env.BLOCKLIST ? process.env.BLOCKLIST.split(',') : []
const CUSTOM_PAYOUT_LIST = process.env.CUSTOM_PAYOUT_LIST ? JSON.parse(process.env.CUSTOM_PAYOUT_LIST) : {}
const CUSTOM_REDIRECTIONS = process.env.CUSTOM_REDIRECTIONS ? JSON.parse(process.env.CUSTOM_REDIRECTIONS) : {}
const CUSTOM_FREQUENCY = process.env.CUSTOM_FREQUENCY ? JSON.parse(process.env.CUSTOM_FREQUENCY) : {}
const WHITELIST = process.env.WHITELIST ? process.env.WHITELIST.split(',') : []
const MIN_BALANCE = process.env.MIN_BALANCE ? new BigNumber(process.env.MIN_BALANCE).times(ARKTOSHI).toFixed(0) : 1
const MAX_HISTORY = process.env.MAX_HISTORY ? process.env.MAX_HISTORY : 6400

const DELEGATE_PAYOUT_SIGNATURE = `${DELEGATE} - `

if (DELEGATE === null) {
  logger.error('No delegate configured!')
  process.exit(1)
}

class TrueBlockWeight {
  constructor () {
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
      const delegatePublicKey = await this.__getDelegate(DELEGATE)
      const forgedBlocks = await this.__getForgedBlocks(delegatePublicKey)
      const currentBlock = forgedBlocks[0].height
      const timestamp = forgedBlocks[0].timestamp + 1
      const delegatePayoutTransactions = await this.__getDelegateTransactions(delegatePublicKey)
      const {votersPerForgedBlock, voters} = await this.__getVoters(delegatePublicKey, forgedBlocks)
      const {voterBalances, votersPublicKeys} = await this.__getVoterBalances(voters)
      const votingDelegateBlocks = await this.__getVotingDelegateBlocks(voters)
      const transactions = await this.__getTransactions(voters, votersPublicKeys)
      await this.psql.close()

      const {latestPayouts, latestPayoutsTimeStamp} = this.__findLatestPayouts(delegatePayoutTransactions)
      const votersBalancePerForgedBlock = this.__processBalances(forgedBlocks, voterBalances, transactions, votingDelegateBlocks)

      this.payouts = new Map()
      this.feesPayouts = new Map()
      this.__generateShares(votersPerForgedBlock, forgedBlocks, latestPayoutsTimeStamp, votersBalancePerForgedBlock)
      this.__applyProposal(currentBlock, latestPayouts)

      const payouts = new Map(this.payouts)
      const delegateProfit = new BigNumber(this.delegateProfit)
      const acfDonation = new BigNumber(this.acfDonation)

      return {payouts, delegateProfit, acfDonation, timestamp}
    } catch (error) {
      logger.error(error)
      return null
    }
  }

 /**
  * @dev   Retrieve the delegate from the database
  **/
  async __getDelegate (delegate) {
    try {
      const getDelegateQuery = queries.getDelegate(delegate)
      const result = await this.psql.query(getDelegateQuery)

      const delegateAddress = result.rows[0].address ? result.rows[0].address : null
      const delegatePublicKey = result.rows[0].publicKey ? result.rows[0].publicKey : null

      if (delegateAddress === null || delegatePublicKey === null) {
        throw new Error('Could not retrieve delegate data.')
      }
      logger.info(`Delegate found: ${delegateAddress}`)
      return delegatePublicKey
    } catch (error) {
      throw new Error(`Error retrieving delegate from database: ${error}`)
    }
  }

  async __getForgedBlocks (delegatePublicKey) {
    try {
      const getForgedBlocksQuery = queries.getForgedBlocks(delegatePublicKey, this.startBlockHeight, MAX_HISTORY)
      const result = await this.psql.query(getForgedBlocksQuery)
      if (result.rows.length === 0) {
        return
      }

      const forgedBlocks = result.rows.map((block) => {
        return {
          'height': parseInt(block.height, 10),
          'fees': new BigNumber(block.totalFee),
          'timestamp': parseInt(block.timestamp, 10)
        }
      })

      const oldestBlock = forgedBlocks[forgedBlocks.length - 1].height
      this.startBlockHeight = oldestBlock - 1
      logger.info(`Forged blocks retrieved: ${JSON.stringify(forgedBlocks.length)} (${forgedBlocks[0].height} - ${oldestBlock})`)
      return forgedBlocks
    } catch (error) {
      logger.error(`Error retrieving forged blocks from database: ${error}`)
    }
  }

  async __getDelegateTransactions (delegatePublicKey) {
    try {
      const getDelegateTransactionsQuery = queries.getDelegateTransactions(this.startBlockHeight, delegatePublicKey)
      const result = await this.psql.query(getDelegateTransactionsQuery)
      if (result.rows.length === 0) {
        return
      }

      const delegatePayoutTransactions = result.rows.map(transaction => {
        const data = this.__deserializeTransaction(transaction.serialized)
        return {
          'height': parseInt(transaction.height, 10),
          'recipientId': transaction.recipient_id,
          'vendorField': data.vendorField,
          'timestamp': parseInt(transaction.timestamp, 10)
        }
      }).filter(transaction => {
        return transaction.vendorField && transaction.vendorField.includes(DELEGATE_PAYOUT_SIGNATURE)
      })
      logger.info(`Delegate Payout Transactions retrieved: ${delegatePayoutTransactions.length}`)
      return delegatePayoutTransactions
    } catch (error) {
      logger.error(`Error retrieving delegate transactions from database: ${error}`)
    }
  }

  async __getVotingDelegateBlocks (voters) {
    try {
      const getVotingDelegatesQuery = queries.getVotingDelegates(voters, this.startBlockHeight)
      const result = await this.psql.query(getVotingDelegatesQuery)
      const votingDelegateBlocks = result.rows.map((block) => {
        return {
          'height': parseInt(block.height, 10),
          'address': block.address,
          'fees': new BigNumber(block.total_fee)
        }
      })
      return votingDelegateBlocks
    } catch (error) {
      logger.error(`Error retrieving voting delegate blocks from database: ${error}`)
    }
  }

  async __getVoters (delegatePublicKey, forgedBlocks) {
    try {
      let __voters = await this.__getCurrentVoters(delegatePublicKey)
      let voterMutations = await this.__getVoterMutations(delegatePublicKey)
      let {votersPerForgedBlock, voters} = this.__setVotersPerForgedBlock(voterMutations, __voters, forgedBlocks)
      voters = this.__processWhiteList(voters)

      return {votersPerForgedBlock, voters}
    } catch (error) {
      throw new Error(`Error retrieving voters ${error}`)
    }
  }

 /**
  * @dev   Retrieve the CURRENT voters of the delegate
  **/
  async __getCurrentVoters (delegatePublicKey) {
    try {
      const getCurrentVotersQuery = queries.getCurrentVoters(delegatePublicKey)
      const result = await this.psql.query(getCurrentVotersQuery)
      if (result.rows.length === 0) {
        return
      }

      const voters = result.rows.map(row => row.address)
      return voters
    } catch (error) {
      logger.error(`Error retrieving current voters from database: ${error}`)
    }
  }

 /**
  * @dev  Get all the votes/unvotes for this delegate that are within range.
  **/
  async __getVoterMutations (delegatePublicKey) {
    try {
      const getVoterSinceHeightQuery = queries.getVoterSinceHeight(this.startBlockHeight)
      const result = await this.psql.query(getVoterSinceHeightQuery)

      if (result.rows.length === 0) {
        return
      }

      const __voteTransactions = result.rows.map(transaction => {
        const data = this.__deserializeTransaction(transaction.serialized)
        return {
          'height': parseInt(transaction.height, 10),
          'address': transaction.recipient_id,
          'vote': data.asset.votes[0]
        }
      }).filter(transaction => {
        return transaction.vote.includes(`${delegatePublicKey}`)
      })

      return __voteTransactions
    } catch (error) {
      logger.error(`Error retrieving voter mutations from database: ${error}`)
    }
  }

  __setVotersPerForgedBlock (voterMutations, voters, forgedBlocks) {
    try {
      let votersRound = voters.slice(0)
      let previousHeight = null
      const __votersPerForgedBlock = new Map(forgedBlocks.map((block) => [block.height, []]))

      __votersPerForgedBlock.forEach((votersDuringBlock, height) => {
        if (previousHeight === null) {
          previousHeight = height + 1
        }

        const __voteTransactions = this.__filterVoteTransactionsForRound(voterMutations, height, previousHeight)
        let {_voters, _votersRound} = this.__mutateVoters(height, previousHeight, votersRound, voters, __voteTransactions)
        voters = _voters.splice(0)
        votersRound = _votersRound.slice(0)
        previousHeight = height
        __votersPerForgedBlock.set(height, votersRound.slice(0))
      })

      const votersPerForgedBlock = new Map(__votersPerForgedBlock)
      return {votersPerForgedBlock, voters}
    } catch (error) {
      logger.error(error)
    }
  }

  __filterVoteTransactionsForRound (voteTransactions, height, previousHeight) {
    const __voteTransactions = voteTransactions.filter(transaction => {
      return transaction.height >= height && transaction.height < previousHeight
    })
    return __voteTransactions
  }

  __mutateVoters (height, previousHeight, votersRound, voters, voteTransactions) {
    try {
      // Process the mutations
      if (voteTransactions.length) {
        for (let item in voteTransactions) {
          if (voteTransactions[item].hasOwnProperty('address') && voteTransactions[item].hasOwnProperty('vote')) {
            // Check if we have seen this voter before
            if (voters.indexOf(voteTransactions[item].address) < 0) {
              voters.push(voteTransactions[item].address)
            }

            // Process the mutation
            if (voteTransactions[item].vote.includes('+')) {
              const index = votersRound.indexOf(voteTransactions[item].address)
              votersRound.splice(index, 1)
            } else if (voteTransactions[item].vote.includes('-')) {
              votersRound.push(voteTransactions[item].address)
            }
          }
        }
      }

      return {_voters: voters, _votersRound: votersRound}
    } catch (error) {
      logger.error(error)
      return []
    }
  }

  __processWhiteList (voters) {
    try {
      const whitelisted = []
      for (let item in voters) {
        const address = voters[item]
        if (BLOCKLIST.indexOf(address) >= 0) {
          logger.warn(`Blacklisted address: ${address} removed from payout pool.`)
        } else if (WHITELIST.length > 0 && WHITELIST.indexOf(address) >= 0) {
          logger.warn(`Whitelisted: ${address} added to payout pool.`)
          whitelisted.push(address)
        } else if (WHITELIST.length === 0) {
          whitelisted.push(address)
        }
      }
      voters = whitelisted.splice(0)
      logger.info(`${voters.length} voters will be calculated.`)
      return voters
    } catch (error) {
      logger.error(error)
    }
  }

  async __getVoterBalances (voters) {
    try {
      // logger.info(`Only voters with a current balance of at least ${new BigNumber(MIN_BALANCE).div(ARKTOSHI).toString()} are eligible.`)
      const getVoterBalancesQuery = queries.getVoterBalances(voters)
      const result = await this.psql.query(getVoterBalancesQuery)
      if (result.rows.length === 0) {
        return
      }

      const voterBalances = result.rows.map((row) => {
        return {
          'address': row.address,
          'publicKey': row.public_key,
          'balance': new BigNumber(row.balance)
        }
      })
      const votersPublicKeys = voterBalances.map(balances => balances.publicKey)
      return {voterBalances, votersPublicKeys}
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

  async __getTransactions (voters, votersPublicKeys) {
    try {
      const getgetTransactionsQuery = queries.getTransactions(voters, votersPublicKeys, this.startBlockHeight)
      const result = await this.psql.query(getgetTransactionsQuery)
      if (result.rows.length === 0) {
        return
      }

      const transactions = result.rows.map(transaction => {
        const senderId = crypto.getAddressFromPublicKey(transaction.sender_public_key, NETWORK_VERSION)
        return {
          'amount': new BigNumber(transaction.amount),
          'height': parseInt(transaction.height, 10),
          'recipientId': transaction.recipient_id,
          'senderId': senderId,
          'sender_public_key': transaction.sender_public_key,
          'fee': new BigNumber(transaction.fee),
          'timestamp': parseInt(transaction.timestamp, 10)
        }
      })

      logger.info(`Transactions retrieved: ${transactions.length}`)
      return transactions
     } catch (error) {
      logger.error(`Error retrieving transactions from database: ${error}`)
    }
  }

  __findLatestPayouts (delegatePayoutTransactions) {
    try {
      const latestPayouts = new Map(delegatePayoutTransactions.map((payoutTransaction) => [payoutTransaction.recipientId, payoutTransaction.height]))
      const latestPayoutsTimeStamp = new Map(delegatePayoutTransactions.map((payoutTransaction) => [payoutTransaction.recipientId, payoutTransaction.timestamp]))
      return {latestPayouts, latestPayoutsTimeStamp}
    } catch (error) {
      logger.error(error)
    }
  }

  __processBalances (forgedBlocks, voterBalances, transactions, votingDelegateBlocks) {
    try {
      let __voters = new Map(voterBalances.map(voterBalances => [voterBalances.address, voterBalances.balance]))
      let previousHeight = null
      const votersBalancePerForgedBlock = new Map(forgedBlocks.map((block) => [block.height, null]))

      votersBalancePerForgedBlock.forEach((votersDuringBlock, height) => {
        if (previousHeight === null) {
          previousHeight = height + 1
        }
        __voters = this.__mutateVotersBalances(height, previousHeight, __voters, transactions, votingDelegateBlocks)
        previousHeight = height
        votersBalancePerForgedBlock.set(height, new Map(__voters))
      })

      return votersBalancePerForgedBlock
    } catch (error) {
      logger.error(error)
    }
  }

  __mutateVotersBalances (height, previousHeight, votersBalancePerForgedBlock, transactions, votingDelegateBlocks) {
    try {
      // Only process mutations that are in range
      const __transactions = transactions.filter(transaction => {
        return transaction.height >= height && transaction.height < previousHeight
      })

      // Process the mutations
      if (__transactions.length) {
        for (let item in __transactions) {
          const recipientId = __transactions[item].recipientId
          const senderId = __transactions[item].senderId
          const amount = __transactions[item].amount
          const fee = __transactions[item].fee

          if (votersBalancePerForgedBlock.has(recipientId)) {
            let balance = votersBalancePerForgedBlock.get(recipientId)
            balance = balance.minus(amount)
            if (balance.lt(0)) {
              balance = new BigNumber(0)
            }
            votersBalancePerForgedBlock.set(recipientId, balance)
          }

          if (votersBalancePerForgedBlock.has(senderId)) {
            let balance = votersBalancePerForgedBlock.get(senderId)
            balance = balance.plus(amount)
            balance = balance.plus(fee)
            votersBalancePerForgedBlock.set(senderId, balance)
          }
        }
      }

      const __votingDelegateBlocks = votingDelegateBlocks.filter(block => {
        return block.height > height && block.height <= previousHeight
      })

      if (__votingDelegateBlocks.length) {
        for (let item in __votingDelegateBlocks) {
          const delegateAddress = __votingDelegateBlocks[item].address
          const fees = __votingDelegateBlocks[item].fees

          let balance = votersBalancePerForgedBlock.get(delegateAddress)
          balance = balance.minus(fees).minus(BLOCK_REWARD)
          if (balance.lt(0)) {
            balance = new BigNumber(0)
          }
          votersBalancePerForgedBlock.set(delegateAddress, balance)
        }
      }

      return votersBalancePerForgedBlock
    } catch (error) {
      logger.error(error)
      return []
    }
  }

  __generateShares (votersPerForgedBlock, forgedBlocks, latestPayoutsTimeStamp, votersBalancePerForgedBlock) {
    try {
      for (let item in forgedBlocks) {
        const height = forgedBlocks[item].height
        const timestamp = forgedBlocks[item].timestamp
        const totalFeesThisBlock = new BigNumber(forgedBlocks[item].fees)
        const validVoters = votersPerForgedBlock.get(height)
        const walletBalances = votersBalancePerForgedBlock.get(height)
        let balance = new BigNumber(0)

        walletBalances.forEach((bal, voter) => {
          // Only add this voter's balance to the total if it exceeds or equals the configured minimum balance.
          bal = new BigNumber(bal)
          if (validVoters.indexOf(voter) >= 0 && bal.gte(MIN_BALANCE)) {
            balance = balance.plus(bal)
          }
        })

        for (let item in validVoters) {
          const address = validVoters[item]
          const payoutAddress = this.__getRedirectAddress(address)
          const latestPayout = latestPayoutsTimeStamp.get(payoutAddress)
          if (latestPayout && latestPayout > timestamp) {
            break
          }

          let pendingPayout = typeof this.payouts.get(address) !== 'undefined' ? new BigNumber(this.payouts.get(address)) : new BigNumber(0)
          const voterBalance = new BigNumber(walletBalances.get(address))

          // Only payout voters that had a ballance that exceeds or equals the configured minimum balance.
          if (voterBalance.gte(MIN_BALANCE)) {
            const voterShare = voterBalance.div(balance)
            const rewardShare = new BigNumber(voterShare.times(BLOCK_REWARD)).decimalPlaces(8)

            pendingPayout = pendingPayout.plus(rewardShare)
            this.payouts.set(address, pendingPayout)

            if (totalFeesThisBlock.gt(0)) {
              let pendingFeesPayout = typeof this.feesPayouts.get(address) !== 'undefined' ? new BigNumber(this.feesPayouts.get(address)) : new BigNumber(0)
              const feeShare = new BigNumber(voterShare.times(totalFeesThisBlock)).decimalPlaces(8)
              pendingFeesPayout = pendingFeesPayout.plus(feeShare)
              this.feesPayouts.set(address, pendingFeesPayout)
            }
          }
        }
      }
    } catch (error) {
      logger.error(error)
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

  __applyProposal (currentBlock, latestPayouts) {
    let totalPayout = new BigNumber(0)
    this.delegateProfit = new BigNumber(0)
    this.acfDonation = new BigNumber(0)

    for (const [address, balance] of this.payouts) {
// TODO: OPTIMIZE THIS
      if (this.__isFrequencyMinimumReached(address, currentBlock, latestPayouts)) {
        // Percentages
        const percentage = this.__getSharePercentage(address)
        this.payouts.set(address, balance.times(percentage))
        this.delegateProfit = this.delegateProfit.plus(balance.times(new BigNumber(1).minus(percentage).minus(this.acfShare)))
        this.acfDonation = this.acfDonation.plus(balance.times(this.acfShare))

        const feePayout = this.feesPayouts.get(address) ? new BigNumber(this.feesPayouts.get(address)).times(this.feesShare) : new BigNumber(0)
        this.feesPayouts.set(address, feePayout)
        this.delegateProfit = this.delegateProfit.plus(feePayout.times(new BigNumber(1).minus(this.feesShare)))

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
  __isFrequencyMinimumReached (address, currentBlock, latestPayouts) {
    const frequency = this.__getFrequencyAddress(address)
    const lastPayoutHeight = latestPayouts.get(address)

    if (!lastPayoutHeight || !frequency) {
      return true;
    }

    const blockMinimums = lastPayoutHeight + frequency
    if (blockMinimums < currentBlock) {
      return true;
    }

    logger.warn(`Payout to ${address} pending (delay of ${frequency} blocks not yet reached) [${blockMinimums}/${currentBlock}]`)
    this.payouts.delete(address)
    return false;
  }
}

module.exports = TrueBlockWeight
