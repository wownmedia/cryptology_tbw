#!/usr/bin/env node

const commander = require('commander')

const {wallet} = require('../lib/commands')

commander
  .version('2.0.0')

commander
  .command('delegate <username>')
  .description('Register as delegate with <username>.')
  .option('-p, --passphrase [passphrase]', 'Enter your passphrase, if you do not enter e passphrase you will be prompted for it.')
  .option('-s, --signature [signature]', 'Enter your second signature, if you do not enter one you will be prompted for it.')
  .option('--fee [fee]', 'Specify a dynamic fee in Arktoshis. Defaults to 2500000000 = 25 ARK.')
  .option('-i, --interactive', 'Prompt to confirm transaction.')
  .action(async (username, cmd) => wallet.delegate(username, cmd))

commander
  .command('signature [signature]')
  .description('Create a second signature.')
  .option('-p, --passphrase [passphrase]', 'Enter your passphrase, if you do not enter e passphrase you will be prompted for it.')
  .option('--fee [fee]', 'Specify a dynamic fee in Arktoshis. Defaults to 500000000 = 5 ARK.')
  .option('-i, --interactive', 'Prompt to confirm transaction.')
  .action(async (signature, cmd) => wallet.signature(signature, cmd))

commander
  .command('send <amount> <recepient>')
  .description('Send <amount> to <recepient>. Valid <amount> format examples: 10, USD10.4, EUR10000, 10000.4')
  .option('-p, --passphrase [passphrase]', 'Enter your passphrase, if you do not enter e passphrase you will be prompted for it.')
  .option('-s, --signature [signature]', 'Enter your second signature, if you do not enter one you will be prompted for it.')
  .option('-b, --smartbridge [smartbridge]', 'Enter a string for the SmartBridge.')
  .option('--fee [fee]', 'Specify a dynamic fee in Arktoshis. Defaults to 10000000 = 0.1 ARK.')
  .option('-i, --interactive', 'Prompt to confirm transaction.')
  .action(async (amount, recepient, cmd) => wallet.send(amount, recepient, cmd))

if (!process.argv.slice(2).length) {
  commander.outputHelp()

  process.exit()
}

commander.parse(process.argv)
