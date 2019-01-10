'use strict'
require('dotenv').config()
const { Transaction } = require('@arkecosystem/crypto').models
const crypto = require('./crypto')
const postgres = require('../services/postgres.js')
const logger = require('../services/logger')
const queries = require('./queries.js')
const BigNumber = require('bignumber.js')
BigNumber.config({DECIMAL_PLACES: 12})

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
const MIN_BALANCE         = process.env.MIN_BALANCE ? new BigNumber(process.env.MIN_BALANCE).times(ARKTOSHI).toFixed(0) : 1

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
      await this.__getCurrentVoters()
      await this.__getVoterMutations()
      await this.__getForgedBlocks()
      this.__setVotersPerForgedBlock()
      this.__processWhiteList() 
      await this.__getVoterBalances()
      await this.__getDelegateTransactions()
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
  
  async __getCurrentVoters () {
    try {
      const getCurrentVotersQuery = queries.getCurrentVoters(this.publicKey)
      const result = await this.psql.query(getCurrentVotersQuery)
      this.voters = result.rows.map(row => row.address)
    } catch (error) {
      logger.error(`Error retrieving current voters from database: ${error}`)
    }
  }
  
  async __getVoterMutations () {
    try {
      const getVoterSinceHeightQuery = queries.getVoterSinceHeight(this.startBlockHeight)
      const result = await this.psql.query(getVoterSinceHeightQuery)
      this.voteTransactions = result.rows.map(transaction => {
        const data = this.__deserializeTransaction(transaction.serialized)
        return {
          'height': parseInt(transaction.height, 10),
          'address': data.recipientId,
          'vote': data.asset.votes[0]
        }
      }).filter(transaction => {
        return transaction.vote.includes(`${this.publicKey}`)
      })
    } catch (error) {
      logger.error(`Error retrieving voter mutations from database: ${error}`)
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
  
  __setVotersPerForgedBlock() {
    try {
      let __voters = this.voters.slice(0)
      let previousHeight = null
      const __votersPerForgedBlock = new Map(this.forgedBlocks.map((block) => [block.height, []]))
      
      __votersPerForgedBlock.forEach((votersDuringBlock, height) => {
        if (previousHeight === null) {
          previousHeight = height +1
        }
        __voters = this.__mutateVoters(height, previousHeight, __voters) 
        previousHeight = height
        __votersPerForgedBlock.set(height, __voters.slice(0))
      })
      
      this.votersPerForgedBlock = new Map(__votersPerForgedBlock)
      
    } catch (error) {
      logger.error(error)
    }
  }
  
  __mutateVoters(height, previousHeight, votersRound) {
    try {
      // Only process mutations that are in range
      const voteTransactions = this.voteTransactions.filter(transaction => {
        return transaction.height >= height && transaction.height < previousHeight
      })
    
      // Process the mutations
      if (voteTransactions.length) {
        for(let item in voteTransactions) {
          if (voteTransactions[item].hasOwnProperty('address') && voteTransactions[item].hasOwnProperty('vote')) {
            
            // Check if we have seen this voter before
            if (this.voters.indexOf(voteTransactions[item].address) < 0) {
              this.voters.push(voteTransactions[item].address)
            }
          
            // Process the mutation
            if(voteTransactions[item].vote.includes('+')) {
              const index = votersRound.indexOf(voteTransactions[item].address)
              votersRound.splice(index, 1)
            } else if(voteTransactions[item].vote.includes('-')) {
              votersRound.push(voteTransactions[item].address)
            }
          }
        }
      }
    
      return votersRound
    } catch (error) {
      logger.error(error)
      return []
    }
  }
  
  __processWhiteList() {
    try {
      const whitelisted = []
      for (let item in this.voters) {
        const address = this.voters[item]
        if (BLOCKLIST.indexOf(address) >= 0) {
          logger.warn(`Blacklisted address: ${address} removed from payout pool.`)
        } else if (WHITELIST.length > 0 && WHITELIST.indexOf(address) >= 0) {
          logger.warn(`Whitelisted: ${address} added to payout pool.`)
          whitelisted.push(address)
        } else if(WHITELIST.length === 0){
          whitelisted.push(address)
        }    
      }
      this.voters = whitelisted.splice(0)
      logger.info(`${this.voters.length} voters will be calculated.`)
    } catch (error) {
      logger.error(error)
    }
  }  

  async __getVoterBalances () {
    try {
      //logger.info(`Only voters with a current balance of at least ${new BigNumber(MIN_BALANCE).div(ARKTOSHI).toString()} are eligible.`)
      const getVoterBalancesQuery = queries.getVoterBalances(this.voters)
      const result = await this.psql.query(getVoterBalancesQuery)

      this.voterBalances = result.rows.map((row) => {
        return {
          'address': row.address,
          'publicKey': row.public_key,
          'balance': new BigNumber(row.balance)
        }
      })
      this.votersPublicKeys = this.voterBalances.map(voterBalances => voterBalances.publicKey)
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

  async __getDelegateTransactions () {
    try {
      const getDelegateTransactionsQuery = queries.getDelegateTransactions(this.startBlockHeight, this.publicKey)
      const result = await this.psql.query(getDelegateTransactionsQuery)
      
      this.delegatePayoutTransactions = result.rows.map(transaction => {
        const data = this.__deserializeTransaction(transaction.serialized)
        return {
          'height': parseInt(transaction.height, 10),
          'recipientId': transaction.recipient_id,
          'vendorField': data.vendorField
        }
      }).filter(transaction => {
        return transaction.vendorField && transaction.vendorField.includes(DELEGATE_PAYOUT_SIGNATURE)
      })
      logger.info(`Delegate Payout Transactions retrieved: ${this.delegatePayoutTransactions.length}`)
    } catch (error) {
      logger.error(`Error retrieving delegate transactions from database: ${error}`)
    }
  }

  async __getTransactions () {
    try {
      const getgetTransactionsQuery = queries.getTransactions(this.voters, this.votersPublicKeys, this.startBlockHeight)
      const result = await this.psql.query(getgetTransactionsQuery)

      this.transactions = result.rows.map(transaction => {
        const senderId = crypto.getAddressFromPublicKey(transaction.sender_public_key, NETWORK_VERSION)
        return {
          'amount': new BigNumber(transaction.amount),
          'height': parseInt(transaction.height, 10),
          'recipientId': transaction.recipient_id,
          'senderId': senderId,
          'sender_public_key': transaction.sender_public_key,
          'fee': new BigNumber(transaction.fee),
          'timestamp': transaction.timestamp
        }
      })

      logger.info(`Transactions retrieved: ${this.transactions.length}`)
     } catch (error) {
      logger.error(`Error retrieving transactions from database: ${error}`)
    }
  }
  
  __findLatestPayouts () {
    this.latestPayouts = new Map(this.delegatePayoutTransactions.map((payoutTransaction) => [payoutTransaction.recipientId, payoutTransaction.height]))
  }
  
  __processBalances () {
    try {
      let __voters = new Map(this.voterBalances.map(voterBalances => [voterBalances.address, voterBalances.balance]))
      let previousHeight = null
      const votersBalancePerForgedBlock = new Map(this.forgedBlocks.map((block) => [block.height, []]))
      
      votersBalancePerForgedBlock.forEach((votersDuringBlock, height) => {
        if (previousHeight === null) {
          previousHeight = height +1
        }
        __voters = this.__mutateVotersBalances(height, previousHeight, __voters) 
        previousHeight = height
        votersBalancePerForgedBlock.set(height, new Map(__voters))
      })
      
      this.votersBalancePerForgedBlock = new Map(votersBalancePerForgedBlock)
    } catch (error) {
      logger.error(error)
    }
  }
  
  __mutateVotersBalances(height, previousHeight, votersBalancePerForgedBlock) {
    
    try {
      // Only process mutations that are in range
      const transactions = this.transactions.filter(transaction => {
        return transaction.height >= height && transaction.height < previousHeight
      })
    
      // Process the mutations
      if (transactions.length) {
        for(let item in transactions) {
          const recipientId = transactions[item].recipientId
          const senderId = transactions[item].senderId
          const amount = transactions[item].amount
          const fee = transactions[item].fee
          
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
    
      return votersBalancePerForgedBlock
    } catch (error) {
      logger.error(error)
      return []
    }
  }
  
  __generateShares () {
    try {
      this.payouts = new Map() //this.voters.map((address) => [address, new BigNumber(0)]))
      this.feesPayouts = new Map() //this.voters.map((address) => [address, new BigNumber(0)]))
      
      
      //let pendingPayout = new BigNumber(0)
      //let pendingFeesPayout = new BigNumber(0)
      
      for(let item in this.forgedBlocks) {
        const height = this.forgedBlocks[item].height
        const totalFeesThisBlock = new BigNumber(this.forgedBlocks[item].fees)
        const validVoters = this.votersPerForgedBlock.get(height)
        const walletBalances = this.votersBalancePerForgedBlock.get(height)
        let balance = new BigNumber(0)
        
//let vvoters = 0        
        walletBalances.forEach((bal, voter) => {
          
          // Only add this voter's balance to the total if it exceeds or equals the configured minimum balance.
          bal = new BigNumber(bal)
          if (validVoters.indexOf(voter) >= 0 && bal.gte(MIN_BALANCE)) {
            balance = balance.plus(bal)
//vvoters++
          }
        })
        
        //console.log(`FEES THIS BLOCK ${totalFeesThisBlock.div(ARKTOSHI).toFixed()}; BALANCE THIS BLOCK ${balance.div(ARKTOSHI).toFixed()}; VOTERS: ${vvoters}/${validVoters.length}/${walletBalances.size}`)
        //let rewardsThisBlock = new BigNumber(0)
        //let percentThisBlock = new BigNumber(0)
        //let balanceThisBlock = new BigNumber(0)
        
        for( let item in validVoters) {
          const address = validVoters[item]
          
          // TODO: CHECK IS ADDRESS WASNT PAYED OUT ALREADY
          
          let pendingPayout = new BigNumber(this.payouts.get(address))
          const voterBalance = new BigNumber(walletBalances.get(address))
          
          // Only payout voters that had a ballance that exceeds or equals the configured minimum balance.
          if(voterBalance.gte(MIN_BALANCE)) {
            const voterShare = voterBalance.div(balance)
            const rewardShare = new BigNumber(voterShare.times(BLOCK_REWARD)).decimalPlaces(8)
          
//rewardsThisBlock = new BigNumber(rewardsThisBlock.plus(rewardShare)).decimalPlaces(8) 
//percentThisBlock = percentThisBlock.plus(voterShare)
//balanceThisBlock = balanceThisBlock.plus(voterBalance)

//console.log(`${address}: ${voterBalance.div(ARKTOSHI).toFixed()} / ${voterShare.times(100).toFixed()}%`)            
            
//if(address === 'AJQCNzjvt2zZXYeZ2zpU8g3CVvupVWntXN') {
            
            pendingPayout = pendingPayout.plus(rewardShare)
            this.payouts.set(address, pendingPayout)
              
            if(totalFeesThisBlock.gt(0)) {
              let pendingFeesPayout = new BigNumber(this.payouts.get(address))
              const feeShare = new BigNumber(voterShare.times(totalFeesThisBlock)).decimalPlaces(8)
              pendingFeesPayout = pendingFeesPayout.plus(feeShare)
              this.feesPayouts.set(address, pendingFeesPayout)
            }
                    
  //console.log(`${address} has ${voterBalance.div(ARKTOSHI).toFixed()} BALANCE. Gets ${rewardShare.div(ARKTOSHI).toFixed()} FROM ${height} / ${balance} at ${voterShare.times(100).toFixed()}%. PENDING ${pendingPayout.div(ARKTOSHI).toFixed()}`)
//}
          
          }
        }
        //console.log(`TOTAL REWARDS FOR THIS BLOCK: ${rewardsThisBlock.div(ARKTOSHI).toFixed()} is ${percentThisBlock.times(100).toFixed()}% Balance: ${balanceThisBlock.div(ARKTOSHI).toFixed()}`)
        
      }
      
      /*
      const forgedBlockVoterBalances = new Map()
      this.votersBalancePerForgedBlock.forEach((votersBalances, height) => {
        const votersThisBlock = this.votersPerForgedBlock.get(height)
        let bal = new BigNumber(0)
        votersBalances.forEach((balance, address) => {
          if (votersThisBlock.indexOf(address) >= 0) {
            bal = bal.plus(balance)
          }
        })
        forgedBlockVoterBalances.set(height, bal)  
      })
    
      console.log(`BLOCKS WITH BALANCES: ${forgedBlockVoterBalances.size}`)
      */
    } catch (error) {
      logger.error(error)
    }
    //forgedBlockVoterBalances.forEach((balance, height) => {
    //  console.log(`BALANCE AT ${height} IS ${balance.div(ARKTOSHI).toFixed()}`)
    //})
    /*return null
    
    const forgedBlockBalances = new Map(this.forgedBlocks.map((block) => [block.height, null]))
    forgedBlockBalances.forEach((votersBalances, height) => {
      const voterBalancesThisBlock = this.votersBalancePerForgedBlock.get(height)
      const votersThisBlock = this.votersPerForgedBlock.get(height)
      
      const validBalancesThisBlock = new Map(votersThisBlock.map((address) => {
        let balance = voterBalancesThisBlock.get(address)
        
        //if(balance > 10000000000) {console.log(`VOTER ${address} HAS ${new BigNumber(balance).div(ARKTOSHI).toFixed()} AT ${height}`)}
        if (!balance || balance < MIN_BALANCE) {
          balance = 0
        }
        return [address, balance]    
      }))
      
      this.votersBalancePerForgedBlock.set(height, null)
      
      let totalBalance = new BigNumber(0)
      validBalancesThisBlock.forEach((balance) =>{
        
        totalBalance = totalBalance.plus(balance)
      })
      
      
      //console.log(`TOTAL BALANCE AT ${height} IS ${totalBalance.div(ARKTOSHI).toFixed()} FROM ${votersThisBlock.length} VOTERS`)
    })
    */
    // for every forged block
    // check who was voting and sum their balances for a total
    // create TBW share per voter, and if not payed out already add it to their balance
    
  }

  

  X__generateShares () {
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
