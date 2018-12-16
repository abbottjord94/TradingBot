# TradingBot
A simple trading bot written with Node.js, using a genetic algorithm to trade bitcoin on the Coinbase exchange at a profit.

The genetic algorithm is based on the use of technical indicators as "genes" to make buy/sell decisions. Technical indicators include RSI (Relative Strength Index) and Bollinger Bands. A more detailed description of the algorithm can be found [here.](https://drive.google.com/file/d/1PmdPLlO-DP7bIeLbcCo3f6TjxgUHmM9P/view?ths=true)

# How To Run
To run, you will first need to ensure that you have Node.js installed. Follow the instructions for your Operating System/Distribution from the [Node.JS website](http://www.nodejs.org)

Once this is installed, you will need to install the Request package via NPM:
`npm install request`

Once completed, the bot can be run in a simulated mode via the following command:
`node tradebotv08b.js`
note: Superuser privileges may be required.

To allow the bot to trade live on the Coinbase Pro exchange, you will need to obtain an API key for your Coinbase account. This key must allow the bot permission to access your account data, and to execute market orders. Once you have obtained the key, copy the key details into your key.json file, located in the same directory as tradebotv08b.js
