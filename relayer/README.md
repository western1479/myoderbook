# OrderBook Relayer (Production-Ready)

Off-chain relayer/aggregator for your OrderBook. It accepts signed EIP-712 orders, validates against on-chain state, stores them in Postgres, streams a live order book over WebSockets, and indexes on-chain settlement events for consistency.

## Features
- Fastify HTTP server with CORS, rate limiting
- WebSocket broadcast by pair (subscribe per base/quote)
- EIP-712 signature verification (ethers v6)
- On-chain validation (tokenAllowed, pairAllowed, minValidNonce, filledBase)
- Postgres persistence with indices and status transitions
- Event indexer for OrderFilled, OrderCancelled, CancelUpTo
- Clean JSON APIs and zod validation

## Endpoints
- POST /orders
  - Body: `{ order: {maker,base,quote,side,amount,price,expiry,nonce}, signature }`
  - Response: `{ orderHash }`
- GET /orderbook?base=0x...&quote=0x...&limit=50
  - Response: `{ bids: [...], asks: [...] }` (raw orders sorted)
- WebSocket `/` (same origin) – subscribe by pair
  - Client -> `{ op: "subscribe", base, quote }`
  - Server -> events:
    - `{ op: "OrderAdded", orderHash, side, price, amount }`
    - `{ op: "OrderUpdated", orderHash }`
    - `{ op: "OrderRemoved", orderHash, reason }`
    - `{ op: "Trade", tx, orderHash, side, fillBase, fillQuote, feeQuote, maker, taker, time }`

## Environment
Copy `.env.example` to `.env` and configure:

```
PORT=8080
ORDERBOOK_ADDRESS=0xc42e757cafa9219716a6b504986005319d6813ea
CHAIN_ID=56
BSC_RPC_URL=https://bsc.publicnode.com
DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/DBNAME
RATE_LIMIT_MAX=300
RATE_LIMIT_TIME_WINDOW=1 minute
```

### Supabase Postgres
- Create a new Supabase project and obtain the connection string.
- Use the `DATABASE_URL` provided by Supabase (Project Settings -> Database -> Connection string).
- Ensure you allow connections from your hosting environment (Supabase handles this by default).

## Running locally
```
cd relayer
npm install
cp .env.example .env
# edit .env
npm run dev
```
Server listens on PORT and exposes both HTTP and WS on the same port.

## Production notes
- Use a dedicated BSC RPC (e.g., QuickNode/Alchemy) for reliability.
- Deploy behind a reverse proxy (NGINX) with HTTPS.
- Configure logging to a centralized sink (pino-compatible) if desired.
- Scale WebSocket with sticky sessions or use a shared pub/sub (Redis) for multiple instances.
- Consider read replicas for Postgres as you scale.
- Add authentication if you need to restrict who can submit orders (optional).

## Frontend integration
- Submit orders to POST /orders after signing the EIP-712 Order in the dApp.
- Seed the book by GET /orderbook?base=&quote=.
- Open a WS to the relayer and subscribe `{ op: 'subscribe', base, quote }`.
- Replace local myOrders display with relayer data. Keep on-chain filling flow (fillOrder), relayer will reflect fills via WS.

## License
MIT
