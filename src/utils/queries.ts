/**
 *
 * @param publicKey
 * @param startBlockHeight
 * @param limit
 */
export const getForgedBlocks = (
    publicKey: string,
    startBlockHeight: number,
    limit: number
): string => {
    return `SELECT blocks.height, blocks.timestamp, blocks.total_fee AS "totalFee" \
          FROM public.blocks \
          WHERE blocks."generator_public_key" = '${publicKey}' \
          AND blocks.height >= ${startBlockHeight} \
          ORDER BY blocks.height DESC \
          LIMIT ${limit};`;
};

/**
 *
 * @param startBlockHeight
 */
export const getVotingDelegates = (startBlockHeight: number): string => {
    return `SELECT blocks."generator_public_key", blocks."height", blocks."total_fee" \
          FROM blocks \
          WHERE blocks.height >= ${startBlockHeight} \
          ORDER BY blocks."height" ASC;`;
};

/**
 *
 * @param startBlockHeight
 */
export const getVoterSinceHeight = (startBlockHeight: number): string => {
    return `SELECT transactions."serialized", transactions."recipient_id" AS "recipientId", blocks."height" \
               FROM transactions INNER JOIN blocks ON blocks."id" = transactions."block_id"  
               WHERE transactions."type" = 3 \
               AND blocks.height >= ${startBlockHeight} \
               ORDER BY blocks."height" ASC;`;
};

/**
 *
 * @param voters
 * @param votersKeys
 * @param startBlockHeight
 */
export const getTransactions = (
    voters: string[],
    votersKeys: string[],
    startBlockHeight: number
): string => {
    const votersAddresses = voters.map(address => `'${address}'`).join(",");
    const votersPublicKeys = votersKeys
        .map(publicKey => `'${publicKey}'`)
        .join(",");

    return `SELECT transactions."serialized", transactions."timestamp", blocks."height" \
               FROM transactions INNER JOIN blocks ON blocks."id" = transactions."block_id"  
               WHERE blocks."height" >= ${startBlockHeight} \
               AND ( transactions."sender_public_key" in (${votersPublicKeys}) \
               OR transactions."recipient_id" in (${votersAddresses}) OR transactions."type" = 6) \
               ORDER BY blocks."height" DESC;`;
};

/**
 *
 * @param startBlockHeight
 * @param delegatePublicKey
 */
export const getDelegateTransactions = (
    startBlockHeight: number,
    delegatePublicKey: string
): string => {
    return `SELECT transactions."serialized", transactions."timestamp", blocks."height" \
               FROM transactions INNER JOIN blocks ON blocks."id" = transactions."block_id"  
               WHERE blocks."height" >= ${startBlockHeight} \
               AND transactions."sender_public_key" = '${delegatePublicKey}' \
               ORDER BY blocks."height" DESC;`;
};
