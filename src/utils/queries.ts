/**
 *
 * @param publicKey
 * @param startBlockHeight
 * @param endBlockHeight
 * @param limit
 */
export const getForgedBlocks = (
    publicKey: string,
    startBlockHeight: number,
    endBlockHeight: number,
    limit: number
): string => {
    let query = `SELECT blocks.height, blocks.timestamp, blocks.total_fee AS "totalFee" \
          FROM public.blocks \
          WHERE blocks."generator_public_key" = '${publicKey}' \
          AND blocks.height >= ${startBlockHeight}`;

    if (endBlockHeight) {
        query = `${query} AND blocks.height <= ${endBlockHeight}`;
    }

    query = `${query} ORDER BY blocks.height DESC LIMIT ${limit};`;

    return query;
};

/**
 *
 * @param startBlockHeight
 * @param endBlockHeight
 */
export const getVotingDelegates = (
    startBlockHeight: number,
    endBlockHeight: number
): string => {
    let query = `SELECT blocks."generator_public_key", blocks."height", blocks."total_fee" \
          FROM blocks \
          WHERE blocks.height >= ${startBlockHeight}`;

    if (endBlockHeight) {
        query = `${query} AND blocks.height <= ${endBlockHeight}`;
    }

    query = `${query} ORDER BY blocks."height" ASC;`;

    return query;
};

/**
 *
 * @param startBlockHeight
 * @param endBlockHeight
 */
export const getVoterSinceHeight = (
    startBlockHeight: number,
    endBlockHeight: number
): string => {
    let query = `SELECT transactions."serialized", transactions."recipient_id" AS "recipientId", blocks."height" \
          FROM transactions INNER JOIN blocks ON blocks."id" = transactions."block_id"  
          WHERE transactions."type" = 3 \
          AND blocks.height >= ${startBlockHeight}`;

    if (endBlockHeight) {
        query = `${query} AND blocks.height <= ${endBlockHeight}`;
    }

    query = `${query} ORDER BY blocks."height" ASC;`;

    return query;
};

/**
 *
 * @param voters
 * @param votersKeys
 * @param startBlockHeight
 * @param endBlockHeight
 */
export const getTransactions = (
    voters: string[],
    votersKeys: string[],
    startBlockHeight: number,
    endBlockHeight: number
): string => {
    const votersAddresses = voters.map((address) => `'${address}'`).join(",");
    const votersPublicKeys = votersKeys
        .map((publicKey) => `'${publicKey}'`)
        .join(",");

    let query = `SELECT transactions."serialized", transactions."timestamp", blocks."height" \
          FROM transactions INNER JOIN blocks ON blocks."id" = transactions."block_id"  
          WHERE blocks."height" >= ${startBlockHeight}`;

    if (endBlockHeight) {
        query = `${query} AND blocks.height <= ${endBlockHeight}`;
    }

    query = `${query} AND ( transactions."sender_public_key" in (${votersPublicKeys}) \
          OR transactions."recipient_id" in (${votersAddresses}) OR transactions."type" = 6) \
          ORDER BY blocks."height" DESC;`;

    return query;
};

/**
 *
 * @param startBlockHeight
 * @param endBlockHeight
 * @param delegatePublicKey
 */
export const getDelegateTransactions = (
    startBlockHeight: number,
    endBlockHeight: number,
    delegatePublicKey: string
): string => {
    let query = `SELECT transactions."serialized", transactions."timestamp", blocks."height" \
          FROM transactions INNER JOIN blocks ON blocks."id" = transactions."block_id"  
          WHERE blocks."height" >= ${startBlockHeight}`;

    if (endBlockHeight) {
        query = `${query} AND blocks.height <= ${endBlockHeight}`;
    }

    query = `${query} AND transactions."sender_public_key" = '${delegatePublicKey}' \
          ORDER BY blocks."height" DESC;`;

    return query;
};
