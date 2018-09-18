'use strict'

exports.getDelegate = (delegate) => {
  return `SELECT m."address", ENCODE(m."publicKey", 'hex') AS "publicKey", m."producedblocks" \
          FROM mem_accounts m   
          WHERE m."isDelegate" = 1 AND m."username" LIKE '${delegate}' \
          LIMIT 1;`
}

exports.getForgedBlocks = (publicKey, startBlockHeight) => {
  return `SELECT blocks.height, blocks."totalFee", blocks.timestamp \
          FROM public.blocks \
          WHERE blocks."generatorPublicKey" = '\\x${publicKey}'\
          AND blocks.height >= ${startBlockHeight} \
          ORDER BY blocks.height DESC;`
}

exports.getVoterBalances = (publicKey) => {
   return `SELECT mem_accounts."balance", mem_accounts."address" \
           FROM mem_accounts \
           WHERE mem_accounts."balance" > 0 \
           AND mem_accounts."address" in (SELECT mem_accounts2delegates."accountId" FROM public.mem_accounts2delegates WHERE mem_accounts2delegates."dependentId" = '${publicKey}') \
           ORDER BY mem_accounts."balance" DESC;`
}

exports.getVoterSinceHeight = (voters) => {
  const votersAddresses = voters.map((address) => `'${address}'`).join(',')

  const query = `SELECT transactions."senderId", transactions."rawasset", blocks."height" \
               FROM transactions INNER JOIN blocks ON blocks."id" = transactions."blockId"  
               WHERE transactions."type" = 3 \
               AND transactions."senderId" in (${votersAddresses}) \
               ORDER BY blocks."height" ASC;`

  return query
}

exports.getTransactions = (voters, startBlockHeight) => {
  const votersAddresses = voters.map((address) => `'${address}'`).join(',')

  const query = `SELECT transactions."id", transactions."amount", transactions."recipientId", transactions."senderId", \
               transactions."fee", transactions."vendorField", transactions."timestamp", blocks."height" \
               FROM transactions INNER JOIN blocks ON blocks."id" = transactions."blockId"  
               WHERE blocks."height" >= ${startBlockHeight} \
               AND (transactions."senderId" in (${votersAddresses}) \
               OR transactions."recipientId" in (${votersAddresses}))
               ORDER BY blocks."height" DESC;`

  return query
}
