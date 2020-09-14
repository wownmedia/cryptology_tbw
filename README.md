_The Cryptology True BlockWeight payout script is licenced under a
[Creative Commons Attribution-NoDerivatives 4.0 International License](https://creativecommons.org/licenses/by-nd/4.0/)._

# Before you start:

**The Cryptology TBW payout script is charging a 0.5% license fee that will automatically be generated
and transferred to a wallet in my control. I realize that not every delegate will agree to this
and in case you do not agree then I suggest you a) write your own script or
b) use one of the other scripts.**

## Why the license fee?

This script now charges a license fee for 2 reasons; firstly I want to stimulate and enable a new kind of proposal model where a delegate can offer to share payouts from a different income stream. In case of `cryptology` this income stream will be the license fee that will be distributed to my voters. We probably all can agree that ARK will thrive well when we can apply new and creative ideas that might draw attention to the project.

Secondly I think a payout script is an essential tool for a delegate, similar to the need of a server and voters.
Part of a delegate skillset would be the ability to create such a script, in case you lack this skillset (or to prevent double work) you can invest in the usage of a 3rd party script such as this one. Nobody questions the need to spend money on their server(s), nor the need to invest in voters (% share and other contributions); so why should the, essential tool, payout script be any different?

# Upgrade from V2.6

Version 3.0 no longer looks for a payment signature in the VendorField. Any transfer from a delegate/validator to a voter is interpreted as a payout.

# Installation

-   Clone the repository to your server;
-   go to the directory of the script;
-   `yarn install`
-   `yarn build`
-   `chmod +x bin/app`
-   `cp example.env .env`
-   `nano .env` and fill out the values for your setup

# Usage

You can use the script in 4 ways:

1. To calculate the amounts that would be paid out: `bin/app`
2. To check the transactions that will be generated: `bin/app check`
3. To payout your voters: `bin/app payout`
4. To payout your voters and check the transactions that were send to the node(s): `bin/app payout check`

Or to use the script from a cron job for automated payments add this line to your crontab:

`00 12 * * * cd ~/cryptology_tbw && node --max-old-space-size=4096 ~/cryptology_tbw/bin/app payout`
