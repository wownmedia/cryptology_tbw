# cryptology_tbw
Cryptology True Block Weight and Fair Fees

1) Clone the project to a server with a full ARK V1 Node running
2) yarn install
3) Copy example.env to .env
4) Edit .env to match your configuration


# Usage
`node bin/app.js` to show calculated payouts

`node bin/app.js payout` to run payouts => will send payouts to your own forger, and wait for it's slot

# Limitations
I have written this script to cater to my own payout setup. I have not taken into account (yet) that there can be over 50 transactions in a payout run. Please make sure to set the start blockheight to the first block after your previous payout and configure the .env NODE to point to the IP of your forger.
