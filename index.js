const { createAlchemyWeb3 } = require('@alch/alchemy-web3')
const BigNumber = require('bignumber.js')
const bodyParser = require('body-parser')
const express = require('express')
const { Telegraf } = require('telegraf')
const throttledQueue = require('throttled-queue')

const app = express()
const PORT = 8000
const TELEGRAM_BOT_TOKEN = 'YOUR_TELEGRAM_BOT_TOKEN'
const TELEGRAM_CHAT_ID = 'YOUR_TELEGRAM_CHAT_ID'
const ALCHEMY_API_KEY = 'YOUR_ALCHEMY_MAINNET_API_KEY'
const tokenMetadata = new Map([
  ['0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', { name: 'USDC', threshold: 500000, decimals: 6 }],
  ['0xdac17f958d2ee523a2206206994597c13d831ec7', { name: 'USDT', threshold: 500000, decimals: 6 }],
  ['0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', { name: 'WETH', threshold: 500, decimals: 18 }],
  ['0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', { name: 'WBTC', threshold: 15, decimals: 8 }],
])
const trackedTokenAddresses = new Set(tokenMetadata.keys())
const whaleTxHashes = new Set()

const bot = new Telegraf(TELEGRAM_BOT_TOKEN)
const web3 = createAlchemyWeb3(`wss://eth-mainnet.alchemyapi.io/v2/${ALCHEMY_API_KEY}`)
const throttle = throttledQueue(5, 1000) // at most 5 requests per second
const numberWithCommas = (x) => x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')

bot.launch()

app.use(bodyParser.json())

app.get('/', (req, res) => {
  res.send('Hello World!')
})

app.post('/webhook', (req, res) => {
  const { type, event } = req.body // webhook data
  event.activity.forEach(async (tx) => {
    if (whaleTxHashes.has(tx.hash)) return
    if (['internal', 'external'].includes(tx.category)) {
      const txData = await throttle(() => web3.eth.getTransactionReceipt(tx.hash))
      if (!Array.isArray(txData.logs) || !txData.logs.length || typeof txData.logs[0].data === 'undefined') return
      const firstTxLog = txData.logs[0]
      const tokenAddress = firstTxLog.address.toLowerCase()
      if (!trackedTokenAddresses.has(tokenAddress)) return
      const tokenThreshold = tokenMetadata.get(tokenAddress) ? tokenMetadata.get(tokenAddress).threshold * 10 ** tokenMetadata.get(tokenAddress).decimals : 10e21
      const isTxApproval = firstTxLog.data === '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
      if (parseInt(firstTxLog.data, 16) > tokenThreshold && !whaleTxHashes.has(tx.hash) && !isTxApproval) {
        whaleTxHashes.add(tx.hash)
        const amount = numberWithCommas((new BigNumber(firstTxLog.data, 16)).div(10 ** tokenMetadata.get(tokenAddress).decimals).toFixed(2)).replace(/\./g, '\\.')
        bot.telegram.sendMessage(
          TELEGRAM_CHAT_ID,
          `\[Whale Alert\] [${amount} ${tokenMetadata.get(tokenAddress).name}](https://etherscan\\.io/tx/${tx.hash}) from [${tx.fromAddress.substring(0, 8)}](https://etherscan\\.io/address/${tx.fromAddress})`,
          { disable_web_page_preview: true, parse_mode: 'MarkdownV2' },
        )
      }
    }
  })

  res.status(200).end()
})

app.listen(PORT, () => {
  console.log(`Telegram Whale Alert listening on port ${PORT}`)
})
