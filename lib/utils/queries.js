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

  const query = `SELECT transactions."serialized", blocks."height" \
               FROM transactions INNER JOIN blocks ON blocks."id" = transactions."block_id"  
               WHERE transactions."type" = 3 \
               AND transactions."sender_public_key" in (${votersPublicKeys}) \
               ORDER BY blocks."height" ASC;`

  return query
}

exports.getTransactions = (voters, votersKeys, startBlockHeight, delegatePublicKey) => {
  const votersAddresses = voters.map((address) => `'${address}'`).join(',')
  const votersPublicKeys = votersKeys.map((publicKey) => `'${publicKey}'`).join(',')

  const query = `SELECT transactions."serialized", transactions."amount", transactions."recipient_id", transactions."sender_public_key", \
               transactions."fee", transactions."vendor_field_hex", transactions."timestamp", blocks."height" \
               FROM transactions INNER JOIN blocks ON blocks."id" = transactions."block_id"  
               WHERE blocks."height" >= ${startBlockHeight} \
               AND ( transactions."sender_public_key" = '${delegatePublicKey}' \
               OR transactions."sender_public_key" in (${votersPublicKeys}) \
               OR transactions."recipient_id" in (${votersAddresses}))
               ORDER BY blocks."height" DESC;`

  return query
}
