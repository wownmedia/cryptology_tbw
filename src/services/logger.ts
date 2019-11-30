import pino from "pino";

export const logger = pino({
    name: "Cryptology TBW",
    safe: true,
    prettyPrint: {
        translateTime: true,
        ignore: "pid,hostname",
    },
});
