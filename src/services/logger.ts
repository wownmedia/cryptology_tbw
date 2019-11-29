import pino from "pino";

// TODO: this needs updating because it uses the old pino syntax
// @ts-ignore
export const logger = pino({
  name: "Cryptology TBW",
  safe: true,
  prettyPrint: {
    translateTime: true,
    ignore: "hostname"
  }
});
