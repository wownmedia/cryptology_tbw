_The Cryptology True BlockWeight payout script is licenced under a
[Creative Commons Attribution-NoDerivatives 4.0 International License](https://creativecommons.org/licenses/by-nd/4.0/)._

# Before you start:

**The Cryptology TBW payout script is charging a 1% license fee that will automatically be generated
and transferred to a wallet in my control. I realize that not every delegate will agree to this
and in case you do not agree then I suggest you a) write your own script or
b) use one of the other scripts.**

# Installation

-   Clone the repository to your server;
-   go to the directory of the script;
-   `yarn install`
-   `yarn build`
-   `chmod +x bin/app`
-   `cp example.env .env`
-   `nano .env` and fill out the values for your setup

if you are upgrading from V2.5 then please make sure to set the `START_BLOCK_HEIGHT` setting to
a height that is above the block where V2.6 went live.

# Usage

You can use the script in 3 ways:

1. To calculate the amounts that would be paid out: `bin/app`
2. To check the transactions that will be generated: `bin/app check`
3. To payout your voters: `bin/app payout`

Or to use the script from a cron job for automated payments add this line to your crontab:

`00 12 * * * cd ~/cryptology_tbw && node --max-old-space-size=4096 ~/cryptology_tbw/bin/app payout`
