'use strict'

exports.getDelegate = (delegate) => {
  return `SELECT address, public_key AS "publicKey" \
          FROM public.wallets \
          WHERE wallets."username" LIKE '${delegate}' \
          LIMIT 1;`
}

exports.getForgedBlocks = (publicKey, startBlockHeight) => {
  //return `SELECT blocks.height, blocks."totalFee", blocks.timestamp \
  //        FROM public.blocks \
  //        WHERE blocks."generatorPublicKey" = '\\x${publicKey}'\
  //        AND blocks.height >= ${startBlockHeight} \
  //        ORDER BY blocks.height DESC;`
  return `SELECT blocks.height, blocks.total_fee AS "totalFee", timestamp \
          FROM public.blocks \
          WHERE blocks."generator_public_key" = '${publicKey}' \
          AND blocks.height >= ${startBlockHeight} \
          ORDER BY blocks.height DESC;`
}

exports.getVoterBalances = (publicKey) => {
   return `SELECT wallets"balance", wallets."address", wallets."public_key" \
           FROM public.wallets \
           WHERE wallets."balance" > 0 \
           AND wallets."vote" = '${publicKey}' \
           ORDER BY wallets."balance" DESC;`
}

exports.getVoterSinceHeight = (voters) => {
  const votersPublicKeys = voters.map((publicKey) => `'${publicKey}'`).join(',')

  const query = `SELECT transactions."sender_public_key", transactions."serialized", blocks."height" \
               FROM transactions INNER JOIN blocks ON blocks."id" = transactions."block_id"  
               WHERE transactions."type" = 3 \
               AND transactions."sender_public_key" in (${votersPublicKeys}) \
               ORDER BY blocks."height" ASC;`

  return query
}

exports.getTransactions = (voters, startBlockHeight, delegateAddress) => {
  const votersAddresses = voters.map((address) => `'${address}'`).join(',')

  const query = `SELECT transactions."id", transactions."amount", transactions."recipientId", transactions."senderId", \
               transactions."fee", transactions."vendorField", transactions."timestamp", blocks."height" \
               FROM transactions INNER JOIN blocks ON blocks."id" = transactions."blockId"  
               WHERE blocks."height" >= ${startBlockHeight} \
               AND ( transactions."senderId" = '${delegateAddress}' \
               OR transactions."senderId" in (${votersAddresses}) \
               OR transactions."recipientId" in (${votersAddresses}))
               ORDER BY blocks."height" DESC;`

  return query
}
