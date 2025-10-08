import 'dotenv/config';
import { ethers } from 'ethers';
import pkg from 'pg';

const { Pool } = pkg;

// ------------ Config ------------
const CONFIG = {
  ORDERBOOK_ADDRESS: (process.env.ORDERBOOK_ADDRESS || '').toLowerCase(),
  CHAIN_ID: Number(process.env.CHAIN_ID || 56),
  EXECUTOR_RPC_URL: process.env.EXECUTOR_RPC_URL || process.env.BSC_HTTP_URL || process.env.BSC_RPC_URL || 'https://bsc.publicnode.com',
  EXECUTOR_PRIVATE_KEY: process.env.EXECUTOR_PRIVATE_KEY || process.env.PRIVATE_KEY || '',
  DATABASE_URL: process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || '',
  LOOP_INTERVAL_MS: Number(process.env.EXECUTOR_LOOP_INTERVAL_MS || 4000),
  MAX_BATCH: Number(process.env.EXECUTOR_MAX_BATCH || 10),
  APPROVE_MAX: process.env.EXECUTOR_APPROVE_MAX !== '0', // set to '0' to disable auto-approve
  GAS_PRICE_GWEI: process.env.EXECUTOR_GAS_PRICE_GWEI ? Number(process.env.EXECUTOR_GAS_PRICE_GWEI) : null,
  RPC_TIMEOUT_MS: Number(process.env.EXECUTOR_RPC_TIMEOUT_MS || 12000),
  ROUTER_ADDRESS: process.env.ROUTER_ADDRESS || ''
};

if (!CONFIG.ORDERBOOK_ADDRESS || !CONFIG.EXECUTOR_PRIVATE_KEY || !CONFIG.DATABASE_URL) {
  console.error('Missing required env ORDERBOOK_ADDRESS or EXECUTOR_PRIVATE_KEY or DATABASE_URL');
  process.exit(1);
}

// ------------ ABIs ------------
const ORDERBOOK_ABI = [
  'function feeBps() view returns (uint16)',
  'function tokenAllowed(address) view returns (bool)',
  'function pairKey(address,address) pure returns (bytes32)',
  'function pairAllowed(bytes32) view returns (bool)',
  'function minValidNonce(address) view returns (uint256)',
  'function filledBase(bytes32) view returns (uint256)',
  'function orderHash((address,address,address,uint8,uint256,uint256,uint256,uint256)) view returns (bytes32)',
  'function fillOrder((address,address,address,uint8,uint256,uint256,uint256,uint256),bytes,uint256) returns (uint256,uint256,uint256)',
  'function fillOrders((address,address,address,uint8,uint256,uint256,uint256,uint256)[],bytes[],uint256[]) returns (uint256,uint256,uint256)'
];

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner,address spender) view returns (uint256)',
  'function approve(address spender,uint256 amount) returns (bool)'
];

// ------------ Setup ------------
const provider = new ethers.JsonRpcProvider(CONFIG.EXECUTOR_RPC_URL, CONFIG.CHAIN_ID);
const wallet = new ethers.Wallet(CONFIG.EXECUTOR_PRIVATE_KEY, provider);
const orderbook = new ethers.Contract(CONFIG.ORDERBOOK_ADDRESS, ORDERBOOK_ABI, wallet);

const pool = new Pool({ connectionString: CONFIG.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Settlement Router (pull taker funds via allowance)
const ROUTER_ABI = [
  'function fillWithAllowance((address,address,address,uint8,uint256,uint256,uint256,uint256),bytes,uint256,address) returns (uint256,uint256,uint256)'
];
const router = CONFIG.ROUTER_ADDRESS ? new ethers.Contract(CONFIG.ROUTER_ADDRESS, ROUTER_ABI, wallet) : null;

// ------------ Helpers ------------
const bn = (x) => BigInt(x);
const ONEe18 = bn('1000000000000000000');

function callWithTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout:${label}`)), ms))
  ]);
}

async function getFeeBps() {
  try { return await callWithTimeout(orderbook.feeBps(), CONFIG.RPC_TIMEOUT_MS, 'feeBps'); } catch { return 40; }
}

function quoteFor(fillBase, price) {
  return (bn(fillBase) * bn(price)) / ONEe18;
}

async function ensureAllowance(token, owner, spender, needed) {
  if (!CONFIG.APPROVE_MAX) return true;
  try {
    const erc = new ethers.Contract(token, ERC20_ABI, wallet);
    const current = await erc.allowance(owner, spender);
    if (bn(current) >= bn(needed)) return true;
    const tx = await erc.approve(spender, ethers.MaxUint256);
    await tx.wait();
    return true;
  } catch (e) {
    console.error('approve error', e?.message || e);
    return false;
  }
}

async function hasBalance(token, owner, needed) {
  try {
    const erc = new ethers.Contract(token, ERC20_ABI, wallet);
    const bal = await erc.balanceOf(owner);
    return bn(bal) >= bn(needed);
  } catch {
    return false;
  }
}

function toOrder(o) {
  return {
    maker: o.maker,
    base: o.base,
    quote: o.quote,
    side: Number(o.side),
    amount: bn(o.amount),
    price: bn(o.price),
    expiry: bn(o.expiry),
    nonce: bn(o.nonce)
  };
}

// For ethers v6 with unnamed tuple components, we must pass arrays (tuples), not objects
function toTupleFromOrder(order) {
  return [
    order.maker,
    order.base,
    order.quote,
    Number(order.side),
    order.amount,
    order.price,
    order.expiry,
    order.nonce
  ];
}

async function revalidate(order, matchFillBase) {
  // On-chain state checks before sending tx
  const key = await orderbook.pairKey(order.base, order.quote);
  const tuple = toTupleFromOrder(order);
  const tokB = await callWithTimeout(orderbook.tokenAllowed(order.base), CONFIG.RPC_TIMEOUT_MS, 'tokenAllowed(base)');
  const tokQ = await callWithTimeout(orderbook.tokenAllowed(order.quote), CONFIG.RPC_TIMEOUT_MS, 'tokenAllowed(quote)');
  const allowed = await callWithTimeout(orderbook.pairAllowed(key), CONFIG.RPC_TIMEOUT_MS, 'pairAllowed');
  const minNonce = await callWithTimeout(orderbook.minValidNonce(order.maker), CONFIG.RPC_TIMEOUT_MS, 'minValidNonce');
  const h = await callWithTimeout(orderbook.orderHash(tuple), CONFIG.RPC_TIMEOUT_MS, 'orderHash');
  let filled = 0n;
  try { filled = await callWithTimeout(orderbook.filledBase(h), CONFIG.RPC_TIMEOUT_MS, 'filledBase'); } catch { filled = 0n; }
  if (!tokB || !tokQ || !allowed) return { ok: false, reason: 'not allowed' };
  if (order.nonce < bn(minNonce)) return { ok: false, reason: 'nonce invalid' };
  if (bn(order.expiry) < bn(Math.floor(Date.now()/1000))) return { ok: false, reason: 'expired' };
  const remaining = order.amount > bn(filled) ? (order.amount - bn(filled)) : 0n;
  if (remaining <= 0n) return { ok: false, reason: 'fully filled' };
  const fill = bn(matchFillBase) < remaining ? bn(matchFillBase) : remaining;
  return { ok: true, hash: h, remaining, fill };
}

function groupBy(arr, keyFn) {
  const m = new Map();
  for (const it of arr) {
    const k = keyFn(it);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(it);
  }
  return m;
}

function payTokenForSide(order) {
  return order.side === 0 ? order.quote : order.base;
}

function payAmountFor(order, fillBase, feeBps) {
  if (order.side === 0) {
    const q = quoteFor(fillBase, order.price);
    const fee = (q * bn(feeBps)) / bn(10000);
    return q + fee;
  }
  return fillBase;
}

async function processBatch(groupRows, _feeBps) {
  if (!groupRows || groupRows.length === 0) return;
  // Router-based settlement: process individually (uses user's allowance)
  for (const row of groupRows) {
    try { await processMatchRow(row, _feeBps); } catch {}
  }
}

async function processMatchRow(row, feeBps) {
  const id = row.id;
  const o = row.order_json; // parsed JSON if pg returns JSON already; else string
  const orderObj = typeof o === 'string' ? JSON.parse(o) : o;
  const order = toOrder(orderObj);
  const signature = row.signature;
  const fillBaseTarget = row.fill_amount_base;

  // Revalidate on-chain
  let rv;
  try { rv = await revalidate(order, fillBaseTarget); }
  catch (e) {
    const err = e?.message || String(e);
    await pool.query('UPDATE matches SET status=$1, last_error=$2, attempts=attempts+1, updated_at=NOW() WHERE id=$3', ['pending', err, id]);
    return;
  }
  if (!rv.ok) {
    await pool.query('UPDATE matches SET status=$1, last_error=$2, attempts=attempts+1, updated_at=NOW() WHERE id=$3', ['failed', rv.reason, id]);
    return;
  }
  const fillBase = rv.fill;

  // Compute required token to pay as taker
  let payToken = null;
  let payAmount = 0n;
  if (order.side === 0) {
    // SELL maker: taker pays quote (+fee)
    const q = quoteFor(fillBase, order.price);
    const fee = (q * bn(feeBps)) / bn(10000);
    payToken = order.quote;
    payAmount = q + fee;
  } else {
    // BUY maker: taker pays base
    payToken = order.base;
    payAmount = fillBase;
  }

  // Router-based settlement: taker is the order.maker
  if (!router) {
    await pool.query('UPDATE matches SET status=$1, last_error=$2, attempts=attempts+1, updated_at=NOW() WHERE id=$3', ['failed', 'router not configured', id]);
    return;
  }
  // Preflight taker allowance and balance
  try {
    const erc = new ethers.Contract(payToken, ERC20_ABI, provider);
    const [allowance, balance] = await Promise.all([
      erc.allowance(order.maker, CONFIG.ROUTER_ADDRESS),
      erc.balanceOf(order.maker)
    ]);
    if (bn(allowance) < bn(payAmount)) {
      await pool.query('UPDATE matches SET status=$1, last_error=$2, attempts=attempts+1, updated_at=NOW() WHERE id=$3', ['pending', 'taker allowance insufficient for router', id]);
      return;
    }
    if (bn(balance) < bn(payAmount)) {
      await pool.query('UPDATE matches SET status=$1, last_error=$2, attempts=attempts+1, updated_at=NOW() WHERE id=$3', ['pending', 'taker insufficient balance', id]);
      return;
    }
  } catch (e) {
    await pool.query('UPDATE matches SET status=$1, last_error=$2, attempts=attempts+1, updated_at=NOW() WHERE id=$3', ['pending', 'preflight failed', id]);
    return;
  }

  // Optional gas price override
  const overrides = {};
  if (CONFIG.GAS_PRICE_GWEI) overrides.gasPrice = ethers.parseUnits(String(CONFIG.GAS_PRICE_GWEI), 'gwei');

  // Submit via router
  try {
    const orderArg = {
      maker: order.maker,
      base: order.base,
      quote: order.quote,
      side: Number(order.side),
      amount: order.amount,
      price: order.price,
      expiry: order.expiry,
      nonce: order.nonce
    };
    const tx = await router.fillWithAllowance(orderArg, signature, fillBase, order.maker, overrides);
    const rcpt = await tx.wait();
    await pool.query('UPDATE matches SET status=$1, last_error=NULL, updated_at=NOW() WHERE id=$2', ['executed', id]);
    console.log('Filled match via router', id, rcpt?.hash);
  } catch (e) {
    console.error('router fill error', e?.shortMessage || e?.message || e);
    await pool.query('UPDATE matches SET status=$1, last_error=$2, attempts=attempts+1, updated_at=NOW() WHERE id=$3', ['failed', e?.shortMessage || e?.message || 'tx error', id]);
  }
}

async function lockPending(limit) {
  // Mark a small set of pending matches as processing and return them
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sel = await client.query(
      `SELECT id, base, quote, side, order_hash, order_json, signature, fill_amount_base
       FROM matches WHERE status='pending' ORDER BY id ASC LIMIT $1 FOR UPDATE SKIP LOCKED`,
      [limit]
    );
    const ids = sel.rows.map(r => r.id);
    if (ids.length > 0) {
      await client.query('UPDATE matches SET status=\'processing\', updated_at=NOW() WHERE id = ANY($1)', [ids]);
    }
    await client.query('COMMIT');
    return sel.rows;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    return [];
  } finally {
    client.release();
  }
}

async function startupLog() {
  try {
    const addr = await wallet.getAddress();
    let block = null;
    try { block = await callWithTimeout(provider.getBlockNumber(), CONFIG.RPC_TIMEOUT_MS, 'getBlockNumber'); } catch (e) { console.error('RPC health check failed', e?.message || e); }
    console.log('Executor started', { chainId: CONFIG.CHAIN_ID, addr, rpc: CONFIG.EXECUTOR_RPC_URL, block });
  } catch (e) { console.error('startup log error', e?.message || e); }
}

async function mainLoop() {
  await startupLog();
  const feeBps = await getFeeBps();
  while (true) {
    try {
      const rows = await lockPending(CONFIG.MAX_BATCH);
      if (rows.length === 0) {
        await new Promise(r => setTimeout(r, CONFIG.LOOP_INTERVAL_MS));
        continue;
      }
      // Group rows by (base, quote, side) to keep the pay token uniform
      const groups = groupBy(rows, (r) => `${r.base.toLowerCase()}_${r.quote.toLowerCase()}_${Number(r.side)}`);
      for (const groupRows of groups.values()) {
        // If only one row in group, fallback to single fill; else batch
        if (groupRows.length === 1) {
          await processMatchRow(groupRows[0], feeBps);
        } else {
          await processBatch(groupRows, feeBps);
        }
      }
    } catch (e) {
      console.error('executor loop error', e?.message || e);
      await new Promise(r => setTimeout(r, CONFIG.LOOP_INTERVAL_MS));
    }
  }
}

mainLoop().catch((e) => {
  console.error('executor fatal', e);
  process.exit(1);
});
