import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { WebSocketServer } from 'ws';
import { ethers, verifyTypedData, TypedDataEncoder } from 'ethers';
import pkg from 'pg';
import { z } from 'zod';
import { fileURLToPath } from 'url';
import path from 'path';

const { Pool } = pkg;

// ---------------------
// Config
// ---------------------
const CONFIG = {
  PORT: Number(process.env.PORT || 8080),
  ORDERBOOK_ADDRESS: (process.env.ORDERBOOK_ADDRESS || '').toLowerCase(),
  CHAIN_ID: Number(process.env.CHAIN_ID || 56),
  BSC_RPC_URL: process.env.BSC_RPC_URL || 'https://bsc.publicnode.com',
  DATABASE_URL: process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || '',
  RATE_LIMIT_MAX: Number(process.env.RATE_LIMIT_MAX || 300),
  RATE_LIMIT_TIME_WINDOW: process.env.RATE_LIMIT_TIME_WINDOW || '1 minute',
  DEPLOY_BLOCK: Number(process.env.ORDERBOOK_DEPLOY_BLOCK || 0),
  BSC_HTTP_URL: process.env.BSC_HTTP_URL || ''
};

if (!CONFIG.ORDERBOOK_ADDRESS || !CONFIG.DATABASE_URL) {
  console.error('Missing required env ORDERBOOK_ADDRESS or DATABASE_URL');
  process.exit(1);
}

// ---------------------
// EIP-712 Domain/Types
// ---------------------
const domain = (chainId, verifyingContract) => ({
  name: 'OrderBook',
  version: '1',
  chainId,
  verifyingContract
});

const types = {
  Order: [
    { name: 'maker', type: 'address' },
    { name: 'base', type: 'address' },
    { name: 'quote', type: 'address' },
    { name: 'side', type: 'uint8' },
    { name: 'amount', type: 'uint256' },
    { name: 'price', type: 'uint256' },
    { name: 'expiry', type: 'uint256' },
    { name: 'nonce', type: 'uint256' }
  ]
};

// ---------------------
// PG Pool
// ---------------------
const pool = new Pool({
  connectionString: CONFIG.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ---------------------
// Ethers provider and contract interface
// ---------------------
const provider = (CONFIG.BSC_RPC_URL || '').startsWith('ws')
  ? new ethers.WebSocketProvider(CONFIG.BSC_RPC_URL, CONFIG.CHAIN_ID)
  : new ethers.JsonRpcProvider(CONFIG.BSC_RPC_URL, CONFIG.CHAIN_ID);
const httpProvider = (CONFIG.BSC_HTTP_URL && CONFIG.BSC_HTTP_URL.startsWith('http'))
  ? new ethers.JsonRpcProvider(CONFIG.BSC_HTTP_URL, CONFIG.CHAIN_ID)
  : ((CONFIG.BSC_RPC_URL || '').startsWith('http') ? new ethers.JsonRpcProvider(CONFIG.BSC_RPC_URL, CONFIG.CHAIN_ID) : null);

const ORDERBOOK_ABI = [
  'function tokenAllowed(address) view returns (bool)',
  'function pairKey(address,address) pure returns (bytes32)',
  'function pairAllowed(bytes32) view returns (bool)',
  'function minValidNonce(address) view returns (uint256)',
  'function filledBase(bytes32) view returns (uint256)',
  'function orderHash((address,address,address,uint8,uint256,uint256,uint256,uint256)) view returns (bytes32)',
  'event OrderFilled(bytes32 indexed orderHash,address indexed maker,address indexed taker,address base,address quote,uint8 side,uint256 fillAmountBase,uint256 fillAmountQuote,uint256 feeQuote,address feePayer)',
  'event OrderCancelled(bytes32 indexed orderHash,address indexed maker)',
  'event CancelUpTo(address indexed maker,uint256 newMinNonce)',
  'event TokenAllowedSet(address indexed token, bool allowed)',
  'event PairAllowedSet(address indexed base, address indexed quote, bool allowed)'
];

const ERC20_ABI = [
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)'
];
const orderbook = new ethers.Contract(CONFIG.ORDERBOOK_ADDRESS, ORDERBOOK_ABI, provider);
const iface = new ethers.Interface(ORDERBOOK_ABI);
const TOPIC_TOKEN_ALLOWED = ethers.id('TokenAllowedSet(address,bool)');
const TOPIC_PAIR_ALLOWED = ethers.id('PairAllowedSet(address,address,bool)');

// ---------------------
// DB bootstrap
// ---------------------
const bootstrapSql = `
CREATE TABLE IF NOT EXISTS orders (
  order_hash TEXT PRIMARY KEY,
  maker TEXT NOT NULL,
  base TEXT NOT NULL,
  quote TEXT NOT NULL,
  side SMALLINT NOT NULL,
  amount NUMERIC(78,0) NOT NULL,
  price NUMERIC(78,0) NOT NULL,
  expiry BIGINT NOT NULL,
  nonce NUMERIC(78,0) NOT NULL,
  remaining NUMERIC(78,0) NOT NULL,
  signature TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_orders_pair_side_price ON orders(base, quote, side, price);
CREATE INDEX IF NOT EXISTS idx_orders_maker ON orders(maker);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

CREATE TABLE IF NOT EXISTS tokens (
  address TEXT PRIMARY KEY,
  symbol TEXT,
  decimals SMALLINT,
  allowed BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tokens_allowed ON tokens(allowed);

CREATE TABLE IF NOT EXISTS pairs (
  base TEXT NOT NULL,
  quote TEXT NOT NULL,
  allowed BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(base, quote)
);
CREATE INDEX IF NOT EXISTS idx_pairs_allowed ON pairs(allowed);
CREATE INDEX IF NOT EXISTS idx_pairs_base_quote ON pairs(base, quote);

CREATE TABLE IF NOT EXISTS matches (
  id BIGSERIAL PRIMARY KEY,
  base TEXT NOT NULL,
  quote TEXT NOT NULL,
  side SMALLINT NOT NULL,
  order_hash TEXT NOT NULL,
  order_json JSONB NOT NULL,
  signature TEXT NOT NULL,
  fill_amount_base NUMERIC(78,0) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  group_id TEXT,
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status);
CREATE INDEX IF NOT EXISTS idx_matches_pair_status ON matches(base, quote, status);

CREATE TABLE IF NOT EXISTS trades (
  id BIGSERIAL PRIMARY KEY,
  base TEXT NOT NULL,
  quote TEXT NOT NULL,
  side SMALLINT NOT NULL,
  fill_base NUMERIC(78,0) NOT NULL,
  fill_quote NUMERIC(78,0) NOT NULL,
  tx TEXT,
  time TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_trades_pair_time ON trades(base, quote, time DESC);
`;

await pool.query(bootstrapSql);

// ---------------------
// Fastify app + HTTP server for WS upgrade
// ---------------------
const app = Fastify({ logger: true });
const allowedOrigins = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
await app.register(cors, { origin: allowedOrigins.length ? allowedOrigins : true });
await app.register(rateLimit, { max: CONFIG.RATE_LIMIT_MAX, timeWindow: CONFIG.RATE_LIMIT_TIME_WINDOW });

// Static frontend (serve CRA build)
try {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const clientDir = path.resolve(__dirname, '../../build');
  await app.register(fastifyStatic, { root: clientDir, prefix: '/' });
} catch (e) {
  try { app.log.warn({ err: e?.message || e }, 'Static serving disabled'); } catch {}
}

const wss = new WebSocketServer({ server: app.server });

// pair topic key
const pairTopic = (base, quote) => `${base.toLowerCase()}_${quote.toLowerCase()}`;
const clients = new Map(); // ws -> { pair }
const rooms = new Map(); // topic -> Set<ws>

function wsBroadcast(topic, msg) {
  const set = rooms.get(topic);
  if (!set) return;
  const data = JSON.stringify(msg);
  for (const ws of set) {
    try { ws.send(data); } catch {}
  }
}

wss.on('connection', (ws) => {
  clients.set(ws, { pair: null });
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.op === 'subscribe') {
        const topic = pairTopic(msg.base, msg.quote);
        clients.get(ws).pair = topic;
        if (!rooms.has(topic)) rooms.set(topic, new Set());
        rooms.get(topic).add(ws);
        ws.send(JSON.stringify({ op: 'subscribed', topic }));
      }
    } catch {}
  });
  ws.on('close', () => {
    const meta = clients.get(ws);
    if (meta?.pair && rooms.has(meta.pair)) rooms.get(meta.pair).delete(ws);
    clients.delete(ws);
  });
});

// ---------------------
// Validation schemas
// ---------------------
const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
const orderSchema = z.object({
  maker: addressSchema,
  base: addressSchema,
  quote: addressSchema,
  side: z.number().int().min(0).max(1),
  amount: z.string(), // bigints as decimal strings
  price: z.string(),
  expiry: z.string(),
  nonce: z.string()
});

const submitSchema = z.object({ order: orderSchema, signature: z.string().regex(/^0x[0-9a-fA-F]+$/) });

// ---------------------
// Helpers
// ---------------------
const bn = (x) => BigInt(x);
const nowSec = () => Math.floor(Date.now() / 1000);

async function computeOrderHash(order) {
  // Use contract for canonical hash
  try {
    return await orderbook.orderHash(order);
  } catch (e) {
    // Fallback to pure encoder if needed
    return TypedDataEncoder.hash(domain(CONFIG.CHAIN_ID, CONFIG.ORDERBOOK_ADDRESS), types, order);
  }
}

async function onchainValidate(order) {
  const [tokenBase, tokenQuote] = await Promise.all([
    orderbook.tokenAllowed(order.base),
    orderbook.tokenAllowed(order.quote)
  ]);
  if (!tokenBase || !tokenQuote) return { ok: false, reason: 'token not allowed' };
  const key = await orderbook.pairKey(order.base, order.quote);
  const allowed = await orderbook.pairAllowed(key);
  if (!allowed) return { ok: false, reason: 'pair not allowed' };
  if (bn(order.expiry) < BigInt(nowSec())) return { ok: false, reason: 'expired' };
  if (!(order.side === 0 || order.side === 1)) return { ok: false, reason: 'bad side' };
  if (bn(order.amount) <= 0n || bn(order.price) <= 0n) return { ok: false, reason: 'bad amount/price' };
  const min = await orderbook.minValidNonce(order.maker);
  if (bn(order.nonce) < bn(min)) return { ok: false, reason: 'nonce invalid' };
  const h = await computeOrderHash(order);
  const filled = await orderbook.filledBase(h);
  if (bn(filled) >= bn(order.amount)) return { ok: false, reason: 'fully filled' };
  return { ok: true, hash: h };
}

// ---------------------
// Allowlist helpers and backfill
// ---------------------
async function fetchTokenMeta(addr) {
  try {
    const erc = new ethers.Contract(addr, ERC20_ABI, provider);
    const [sym, dec] = await Promise.all([
      erc.symbol().catch(() => null),
      erc.decimals().catch(() => 18)
    ]);
    return { symbol: sym || addr.slice(0, 6).toUpperCase(), decimals: Number(dec) || 18 };
  } catch {
    return { symbol: addr.slice(0, 6).toUpperCase(), decimals: 18 };
  }
}

async function ensureTokenMeta(addr) {
  const a = String(addr).toLowerCase();
  const { rows } = await pool.query('SELECT address, symbol, decimals FROM tokens WHERE address=$1', [a]);
  if (rows[0] && rows[0].symbol && rows[0].decimals != null) return rows[0];
  const meta = await fetchTokenMeta(a);
  await pool.query(
    'INSERT INTO tokens(address, symbol, decimals, allowed, updated_at) VALUES($1,$2,$3,COALESCE((SELECT allowed FROM tokens WHERE address=$1), FALSE), NOW()) ON CONFLICT(address) DO UPDATE SET symbol=EXCLUDED.symbol, decimals=EXCLUDED.decimals, updated_at=NOW()',
    [a, meta.symbol, meta.decimals]
  );
  return { address: a, ...meta };
}

async function setTokenAllowedDB(addr, allowed) {
  const a = String(addr).toLowerCase();
  await ensureTokenMeta(a);
  await pool.query('INSERT INTO tokens(address, allowed, updated_at) VALUES($1,$2,NOW()) ON CONFLICT(address) DO UPDATE SET allowed=EXCLUDED.allowed, updated_at=NOW()', [a, !!allowed]);
}

async function setPairAllowedDB(base, quote, allowed) {
  const b = String(base).toLowerCase();
  const q = String(quote).toLowerCase();
  await pool.query('INSERT INTO pairs(base, quote, allowed, updated_at) VALUES($1,$2,$3,NOW()) ON CONFLICT(base,quote) DO UPDATE SET allowed=EXCLUDED.allowed, updated_at=NOW()', [b, q, !!allowed]);
}

async function backfillAllowlist() {
  if (!CONFIG.DEPLOY_BLOCK || CONFIG.DEPLOY_BLOCK <= 0) return;
  try {
    const p = httpProvider ?? provider;
    const latest = await p.getBlockNumber();
    const step = 500; // conservative chunk to avoid provider internal errors
    for (let from = CONFIG.DEPLOY_BLOCK; from <= latest; from += step + 1) {
      const to = Math.min(latest, from + step);
      // TokenAllowedSet
      let tokenLogs = [];
      try {
        tokenLogs = await (httpProvider ?? provider).getLogs({ address: CONFIG.ORDERBOOK_ADDRESS, topics: [TOPIC_TOKEN_ALLOWED], fromBlock: from, toBlock: to });
      } catch (e) {
        console.error('backfill token logs error', e?.message || e);
      }
      for (const log of tokenLogs) {
        try {
          const parsed = iface.parseLog(log);
          if (parsed?.name === 'TokenAllowedSet') {
            const token = parsed.args[0];
            const allowed = parsed.args[1];
            await setTokenAllowedDB(token, allowed);
          }
        } catch {}
      }
      // PairAllowedSet
      let pairLogs = [];
      try {
        pairLogs = await (httpProvider ?? provider).getLogs({ address: CONFIG.ORDERBOOK_ADDRESS, topics: [TOPIC_PAIR_ALLOWED], fromBlock: from, toBlock: to });
      } catch (e) {
        console.error('backfill pair logs error', e?.message || e);
      }
      for (const log of pairLogs) {
        try {
          const parsed = iface.parseLog(log);
          if (parsed?.name === 'PairAllowedSet') {
            const base = parsed.args[0];
            const quote = parsed.args[1];
            const allowed = parsed.args[2];
            await Promise.all([ensureTokenMeta(base), ensureTokenMeta(quote)]);
            await setPairAllowedDB(base, quote, allowed);
          }
        } catch {}
      }
    }
  } catch (e) {
    console.error('Allowlist backfill error', e);
  }
}

function startAllowlistPoller() {
  let last = 0;
  const step = 500;
  const intervalMs = 20000;
  const tick = async () => {
    try {
      const p = httpProvider ?? provider;
      const current = await p.getBlockNumber();
      if (last === 0) { last = current; return; }
      let from = last + 1;
      while (from <= current) {
        const to = Math.min(current, from + step);
        let tokenLogs = [];
        try { tokenLogs = await (httpProvider ?? provider).getLogs({ address: CONFIG.ORDERBOOK_ADDRESS, topics: [TOPIC_TOKEN_ALLOWED], fromBlock: from, toBlock: to }); } catch (e) { console.error('poll token logs error', e?.message || e); }
        for (const log of tokenLogs) {
          try { const p = iface.parseLog(log); if (p?.name === 'TokenAllowedSet') await setTokenAllowedDB(p.args[0], p.args[1]); } catch {}
        }
        let pairLogs = [];
        try { pairLogs = await (httpProvider ?? provider).getLogs({ address: CONFIG.ORDERBOOK_ADDRESS, topics: [TOPIC_PAIR_ALLOWED], fromBlock: from, toBlock: to }); } catch (e) { console.error('poll pair logs error', e?.message || e); }
        for (const log of pairLogs) {
          try { const p = iface.parseLog(log); if (p?.name === 'PairAllowedSet') { await Promise.all([ensureTokenMeta(p.args[0]), ensureTokenMeta(p.args[1])]); await setPairAllowedDB(p.args[0], p.args[1], p.args[2]); } } catch {}
        }
        from = to + 1;
      }
      last = current;
    } catch (e) {
      console.error('Allowlist poller error', e);
    }
  };
  setInterval(tick, intervalMs);
}

// ---------------------
// Matching helpers
// ---------------------
async function getBestOpposite(base, quote, side) {
  // side: maker side of the new order; opposite side to query
  const oppSide = side === 0 ? 1 : 0;
  const text = oppSide === 1
    ? `SELECT order_hash, maker, base, quote, side, amount, price, expiry, nonce, remaining, signature
       FROM orders
       WHERE base=$1 AND quote=$2 AND status='active' AND expiry > extract(epoch from now()) AND side=1
       ORDER BY price DESC, created_at ASC
       LIMIT 1`
    : `SELECT order_hash, maker, base, quote, side, amount, price, expiry, nonce, remaining, signature
       FROM orders
       WHERE base=$1 AND quote=$2 AND status='active' AND expiry > extract(epoch from now()) AND side=0
       ORDER BY price ASC, created_at ASC
       LIMIT 1`;
  const { rows } = await pool.query(text, [base.toLowerCase(), quote.toLowerCase()]);
  return rows[0] || null;
}

async function priceCrosses(newOrder, bestOpp) {
  if (!bestOpp) return false;
  try {
    const newP = BigInt(newOrder.price);
    const oppP = BigInt(bestOpp.price);
    if (Number(newOrder.side) === 0) {
      // SELL maker crosses if bestBid >= ask
      return oppP >= newP;
    } else {
      // BUY maker crosses if bestAsk <= bid
      return oppP <= newP;
    }
  } catch { return false; }
}

async function tryEnqueueMatch(newOrder, _signature) {
  try {
    // Remaining amount for the new order
    let remainingNew;
    try { remainingNew = BigInt(newOrder.amount ?? '0'); } catch { remainingNew = 0n; }
    if (remainingNew <= 0n) return;

    // Ensure price crosses and get best opposite maker order
    const bestOpp = await getBestOpposite(newOrder.base, newOrder.quote, Number(newOrder.side));
    const crosses = await priceCrosses(newOrder, bestOpp);
    if (!crosses || !bestOpp) return;

    // Build opposite maker order struct (from DB row)
    const oppOrder = {
      maker: String(bestOpp.maker).toLowerCase(),
      base: String(bestOpp.base).toLowerCase(),
      quote: String(bestOpp.quote).toLowerCase(),
      side: Number(bestOpp.side),
      amount: String(bestOpp.amount),
      price: String(bestOpp.price),
      expiry: String(bestOpp.expiry),
      nonce: String(bestOpp.nonce)
    };

    // Compute hash of opposite maker order
    const oppHash = (await computeOrderHash(oppOrder)).toLowerCase();

    // Fill amount is the minimum of both sides' remaining
    let remainingOpp;
    try { remainingOpp = BigInt(bestOpp.remaining ?? '0'); } catch { remainingOpp = 0n; }
    const fillBase = remainingNew < remainingOpp ? remainingNew : remainingOpp;
    if (fillBase <= 0n) return;

    // Insert match: order to fill is the opposite maker order; taker is the new order maker (store in group_id)
    await pool.query(
      `INSERT INTO matches(base,quote,side,order_hash,order_json,signature,fill_amount_base,status,group_id,attempts)
       VALUES($1,$2,$3,$4,$5,$6,$7,'pending',$8,0)`,
      [
        oppOrder.base,
        oppOrder.quote,
        oppOrder.side,
        oppHash,
        oppOrder,
        bestOpp.signature,
        String(fillBase),
        String(newOrder.maker).toLowerCase()
      ]
    );
  } catch (e) {
    console.error('tryEnqueueMatch error', e);
  }
}

// ---------------------
// Routes
// ---------------------
app.post('/orders', async (req, reply) => {
  try {
    const body = submitSchema.parse(req.body);
    const order = normalizeOrder(body.order);

    // Verify signature
    const recovered = verifyTypedData(domain(CONFIG.CHAIN_ID, CONFIG.ORDERBOOK_ADDRESS), types, order, body.signature);
    if (recovered.toLowerCase() !== order.maker.toLowerCase()) {
      return reply.code(400).send({ error: 'bad signature' });
    }

    // On-chain validation
    const v = await onchainValidate(order);
    if (!v.ok) return reply.code(400).send({ error: v.reason });

    const orderHash = v.hash.toLowerCase();

    // Insert into DB
    const text = `INSERT INTO orders(order_hash,maker,base,quote,side,amount,price,expiry,nonce,remaining,signature,status)
                  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'active')
                  ON CONFLICT (order_hash) DO NOTHING`;
    const values = [
      orderHash,
      order.maker.toLowerCase(),
      order.base.toLowerCase(),
      order.quote.toLowerCase(),
      order.side,
      order.amount,
      order.price,
      order.expiry,
      order.nonce,
      order.amount,
      body.signature
    ];
    await pool.query(text, values);

    // Broadcast
    const topic = pairTopic(order.base, order.quote);
    wsBroadcast(topic, { op: 'OrderAdded', orderHash, side: order.side, price: order.price, amount: order.amount });

    // Fire-and-forget: enqueue a match intent if prices cross (executor will settle)
    try { setTimeout(() => { tryEnqueueMatch(order, body.signature); }, 0); } catch {}

    return reply.send({ orderHash });
  } catch (e) {
    req.log.error(e);
    return reply.code(400).send({ error: 'invalid payload' });
  }
});

app.get('/orderbook', async (req, reply) => {
  const q = req.query || {};
  const base = String(q.base || '').toLowerCase();
  const quote = String(q.quote || '').toLowerCase();
  const limit = Math.min(100, Number(q.limit || 50));
  if (!/^0x[0-9a-f]{40}$/.test(base) || !/^0x[0-9a-f]{40}$/.test(quote)) return reply.code(400).send({ error: 'bad pair' });

  const text = `SELECT order_hash, side, amount, price, remaining, maker FROM orders
                WHERE base=$1 AND quote=$2 AND status='active' AND expiry > extract(epoch from now())
                ORDER BY side ASC, price ASC`;
  const { rows } = await pool.query(text, [base, quote]);

  const bids = [], asks = [];
  for (const r of rows) {
    const rec = { id: r.order_hash, side: Number(r.side), amount: r.amount, price: r.price, remaining: r.remaining, maker: r.maker };
    if (rec.side === 0) asks.push(rec); else bids.push(rec);
  }
  // sort: bids desc, asks asc
  bids.sort((a,b) => (BigInt(b.price) > BigInt(a.price) ? 1 : -1));
  asks.sort((a,b) => (BigInt(a.price) > BigInt(b.price) ? 1 : -1));

  return reply.send({ bids: bids.slice(0, limit), asks: asks.slice(0, limit) });
});

app.get('/markets', async (_req, reply) => {
  const { rows: pairs } = await pool.query('SELECT base, quote FROM pairs WHERE allowed=TRUE ORDER BY base, quote LIMIT 500');
  const out = [];
  for (const p of pairs) {
    const base = String(p.base).toLowerCase();
    const quote = String(p.quote).toLowerCase();
    const [b, q] = await Promise.all([
      (async () => {
        const r = await pool.query('SELECT address, symbol, decimals FROM tokens WHERE address=$1', [base]);
        if (!r.rows[0] || r.rows[0].symbol == null || r.rows[0].decimals == null) {
          const meta = await ensureTokenMeta(base);
          return { address: base, symbol: meta.symbol, decimals: meta.decimals };
        }
        return { address: base, symbol: r.rows[0].symbol, decimals: Number(r.rows[0].decimals) };
      })(),
      (async () => {
        const r = await pool.query('SELECT address, symbol, decimals FROM tokens WHERE address=$1', [quote]);
        if (!r.rows[0] || r.rows[0].symbol == null || r.rows[0].decimals == null) {
          const meta = await ensureTokenMeta(quote);
          return { address: quote, symbol: meta.symbol, decimals: meta.decimals };
        }
        return { address: quote, symbol: r.rows[0].symbol, decimals: Number(r.rows[0].decimals) };
      })()
    ]);
    out.push({ id: `${b.symbol}/${q.symbol}`, base: b, quote: q });
  }
  return reply.send(out);
});

// ---------------------
// Event indexer
// ---------------------
orderbook.on('OrderFilled', async (orderHash, maker, taker, base, quote, side, fillBase, fillQuote, feeQuote, feePayer, evt) => {
  try {
    const h = String(orderHash).toLowerCase();
    // decrement remaining
    await pool.query('UPDATE orders SET remaining = GREATEST(remaining::numeric - $1::numeric, 0), updated_at=NOW() WHERE order_hash=$2', [String(fillBase), h]);

    // broadcast trade with robust tx hash extraction
    const topic = pairTopic(base, quote);
    const txh = (evt && evt.log && evt.log.transactionHash) || evt?.transactionHash || (evt?.transaction && evt.transaction.hash) || null;
    try { app.log.info({ txh, orderHash: h, maker, taker }, 'OrderFilled -> broadcast Trade'); } catch {}
    if (!txh) { try { app.log.warn({ evt }, 'OrderFilled missing tx hash on event'); } catch {} }
    wsBroadcast(topic, { op: 'Trade', tx: txh, orderHash: h, side: Number(side), fillBase: String(fillBase), fillQuote: String(fillQuote), feeQuote: String(feeQuote), maker, taker, base: String(base).toLowerCase(), quote: String(quote).toLowerCase(), time: Date.now() });
    try {
      await pool.query(
        'INSERT INTO trades(base,quote,side,fill_base,fill_quote,tx,time) VALUES($1,$2,$3,$4,$5,$6,NOW())',
        [String(base).toLowerCase(), String(quote).toLowerCase(), Number(side), String(fillBase), String(fillQuote), txh]
      );
    } catch (e) { app.log.error('trade insert error', e); }

    // remove if fully filled
    await pool.query("UPDATE orders SET status='filled', updated_at=NOW() WHERE order_hash=$1 AND remaining='0'", [h]);
    wsBroadcast(topic, { op: 'OrderUpdated', orderHash: h });
  } catch (e) { console.error('OrderFilled handling error', e); }
});

orderbook.on('OrderCancelled', async (orderHash, maker) => {
  try {
    const h = String(orderHash).toLowerCase();
    const { rows } = await pool.query('SELECT base,quote FROM orders WHERE order_hash=$1', [h]);
    await pool.query("UPDATE orders SET status='cancelled', updated_at=NOW() WHERE order_hash=$1", [h]);
    if (rows[0]) {
      const topic = pairTopic(rows[0].base, rows[0].quote);
      wsBroadcast(topic, { op: 'OrderRemoved', orderHash: h, reason: 'cancelled' });
    }
  } catch (e) { console.error('OrderCancelled handling error', e); }
});

orderbook.on('CancelUpTo', async (maker, newMin) => {
  try {
    const m = String(maker).toLowerCase();
    const { rows } = await pool.query('SELECT order_hash, base, quote FROM orders WHERE maker=$1 AND nonce < $2 AND status=\'active\'', [m, String(newMin)]);
    await pool.query("UPDATE orders SET status='cancelled', updated_at=NOW() WHERE maker=$1 AND nonce < $2 AND status='active'", [m, String(newMin)]);
    for (const r of rows) {
      const topic = pairTopic(r.base, r.quote);
      wsBroadcast(topic, { op: 'OrderRemoved', orderHash: r.order_hash, reason: 'cancelUpTo' });
    }
  } catch (e) { console.error('CancelUpTo handling error', e); }
});

// Allowlist via live events only (no polling)
orderbook.on('TokenAllowedSet', async (token, allowed) => {
  try {
    await setTokenAllowedDB(token, allowed);
  } catch (e) { console.error('TokenAllowedSet handling error', e); }
});

orderbook.on('PairAllowedSet', async (base, quote, allowed) => {
  try {
    await Promise.all([ensureTokenMeta(base), ensureTokenMeta(quote)]);
    await setPairAllowedDB(base, quote, allowed);
  } catch (e) { console.error('PairAllowedSet handling error', e); }
});


// ---------------------
// Utils
// ---------------------
function normalizeOrder(o) {
  return {
    maker: o.maker.toLowerCase(),
    base: o.base.toLowerCase(),
    quote: o.quote.toLowerCase(),
    side: Number(o.side),
    amount: String(o.amount),
    price: String(o.price),
    expiry: String(o.expiry),
    nonce: String(o.nonce)
  };
}

// ---------------------
// Market stats endpoint
// ---------------------
async function computePairStats(base, quote) {
  try {
    const b = String(base).toLowerCase();
    const q = String(quote).toLowerCase();
    const [bMeta, qMeta] = await Promise.all([ensureTokenMeta(b), ensureTokenMeta(q)]);
    const bd = Number(bMeta?.decimals ?? 18);
    const qd = Number(qMeta?.decimals ?? 18);

    const lastRes = await pool.query('SELECT fill_base, fill_quote, time FROM trades WHERE base=$1 AND quote=$2 ORDER BY time DESC LIMIT 1', [b, q]);
    let lastPrice = null;
    if (lastRes.rows[0]) {
      try {
        const fb = lastRes.rows[0].fill_base;
        const fq = lastRes.rows[0].fill_quote;
        const p = Number(ethers.formatUnits(fq, qd)) / Number(ethers.formatUnits(fb, bd));
        if (isFinite(p)) lastPrice = p;
      } catch {}
    }

    const sinceRes = await pool.query("SELECT fill_base, fill_quote, time FROM trades WHERE base=$1 AND quote=$2 AND time >= NOW() - INTERVAL '24 hours' ORDER BY time ASC", [b, q]);
    let volumeQuote24h = 0;
    let change24h = 0;
    if (sinceRes.rows.length > 0) {
      for (const r of sinceRes.rows) {
        try { volumeQuote24h += Number(ethers.formatUnits(r.fill_quote, qd)); } catch {}
      }
      const first = sinceRes.rows[0];
      const last = sinceRes.rows[sinceRes.rows.length - 1];
      try {
        const firstPrice = Number(ethers.formatUnits(first.fill_quote, qd)) / Number(ethers.formatUnits(first.fill_base, bd));
        const lastPrice24 = Number(ethers.formatUnits(last.fill_quote, qd)) / Number(ethers.formatUnits(last.fill_base, bd));
        if (firstPrice > 0) change24h = ((lastPrice24 - firstPrice) / firstPrice) * 100;
        if (lastPrice == null) lastPrice = lastPrice24;
      } catch {}
    }

    return { base: b, quote: q, lastPrice, volumeQuote24h, change24h };
  } catch (e) {
    return { base, quote, lastPrice: null, volumeQuote24h: 0, change24h: 0 };
  }
}

app.get('/market-stats', async (req, reply) => {
  try {
    const q = req.query || {};
    const base = String(q.base || '').toLowerCase();
    const quote = String(q.quote || '').toLowerCase();
    if (base && quote) {
      if (!/^0x[0-9a-f]{40}$/.test(base) || !/^0x[0-9a-f]{40}$/.test(quote)) return reply.code(400).send({ error: 'bad pair' });
      const s = await computePairStats(base, quote);
      return reply.send(s);
    } else {
      const { rows: pairs } = await pool.query('SELECT base, quote FROM pairs WHERE allowed=TRUE ORDER BY base, quote LIMIT 500');
      const out = [];
      for (const p of pairs) out.push(await computePairStats(p.base, p.quote));
      return reply.send(out);
    }
  } catch (e) {
    req.log.error(e);
    return reply.code(500).send({ error: 'failed' });
  }
});

// SPA fallback for client-side routes using notFound handler
app.setNotFoundHandler((req, reply) => {
  if (req.raw.method === 'GET') {
    try {
      return reply.type('text/html').sendFile('index.html');
    } catch {
      return reply.code(404).send({ error: 'not found' });
    }
  }
  return reply.code(404).send({ error: 'not found' });
});

// ---------------------
// Start
// ---------------------
if (CONFIG.DEPLOY_BLOCK > 0) {
  try { await backfillAllowlist(); app.log.info('Allowlist backfilled'); } catch (e) { app.log.error(e); }
}
app.log.info('Allowlist poller disabled; using live WS events only');
app.listen({ port: CONFIG.PORT, host: '0.0.0.0' }).then(() => {
  console.log(`Relayer listening on :${CONFIG.PORT}`);
}).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
