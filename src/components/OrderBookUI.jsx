import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { BrowserProvider, Contract, parseUnits, formatUnits, toBigInt, getAddress } from 'ethers';
import { useWeb3Modal, useWeb3ModalAccount, useWeb3ModalProvider } from '@web3modal/ethers/react';

// Deployed OrderBook (BSC)
const ORDERBOOK_ADDRESS = '0xc42e757Cafa9219716A6b504986005319d6813eA';
// Deployed Settlement Router (pull taker funds via allowance)
const ROUTER_ADDRESS = '0xd753D91AE23D79A4178368efef2981aee315ccaA';

// Minimal ERC20 ABI for approvals and metadata
const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function balanceOf(address) view returns (uint256)'
];

// OrderBook ABI (provided)
const ORDERBOOK_ABI = [
  { "inputs": [], "stateMutability": "nonpayable", "type": "constructor" },
  { "inputs": [], "name": "InvalidShortString", "type": "error" },
  { "inputs": [{ "internalType": "string", "name": "str", "type": "string" }], "name": "StringTooLong", "type": "error" },
  { "anonymous": false, "inputs": [{ "indexed": true, "internalType": "address", "name": "maker", "type": "address" }, { "indexed": false, "internalType": "uint256", "name": "newMinNonce", "type": "uint256" }], "name": "CancelUpTo", "type": "event" },
  { "anonymous": false, "inputs": [], "name": "EIP712DomainChanged", "type": "event" },
  { "anonymous": false, "inputs": [{ "indexed": false, "internalType": "uint16", "name": "feeBps", "type": "uint16" }, { "indexed": false, "internalType": "address", "name": "feeRecipient", "type": "address" }], "name": "FeeParamsUpdated", "type": "event" },
  { "anonymous": false, "inputs": [{ "indexed": true, "internalType": "bytes32", "name": "orderHash", "type": "bytes32" }, { "indexed": true, "internalType": "address", "name": "maker", "type": "address" }], "name": "OrderCancelled", "type": "event" },
  { "anonymous": false, "inputs": [{ "indexed": true, "internalType": "bytes32", "name": "orderHash", "type": "bytes32" }, { "indexed": true, "internalType": "address", "name": "maker", "type": "address" }, { "indexed": true, "internalType": "address", "name": "taker", "type": "address" }, { "indexed": false, "internalType": "address", "name": "base", "type": "address" }, { "indexed": false, "internalType": "address", "name": "quote", "type": "address" }, { "indexed": false, "internalType": "uint8", "name": "side", "type": "uint8" }, { "indexed": false, "internalType": "uint256", "name": "fillAmountBase", "type": "uint256" }, { "indexed": false, "internalType": "uint256", "name": "fillAmountQuote", "type": "uint256" }, { "indexed": false, "internalType": "uint256", "name": "feeQuote", "type": "uint256" }, { "indexed": false, "internalType": "address", "name": "feePayer", "type": "address" }], "name": "OrderFilled", "type": "event" },
  { "anonymous": false, "inputs": [{ "indexed": true, "internalType": "address", "name": "previousOwner", "type": "address" }, { "indexed": true, "internalType": "address", "name": "newOwner", "type": "address" }], "name": "OwnershipTransferStarted", "type": "event" },
  { "anonymous": false, "inputs": [{ "indexed": true, "internalType": "address", "name": "previousOwner", "type": "address" }, { "indexed": true, "internalType": "address", "name": "newOwner", "type": "address" }], "name": "OwnershipTransferred", "type": "event" },
  { "anonymous": false, "inputs": [{ "indexed": true, "internalType": "address", "name": "base", "type": "address" }, { "indexed": true, "internalType": "address", "name": "quote", "type": "address" }, { "indexed": false, "internalType": "bool", "name": "allowed", "type": "bool" }], "name": "PairAllowedSet", "type": "event" },
  { "anonymous": false, "inputs": [{ "indexed": false, "internalType": "address", "name": "account", "type": "address" }], "name": "Paused", "type": "event" },
  { "anonymous": false, "inputs": [{ "indexed": true, "internalType": "address", "name": "token", "type": "address" }, { "indexed": false, "internalType": "bool", "name": "allowed", "type": "bool" }], "name": "TokenAllowedSet", "type": "event" },
  { "anonymous": false, "inputs": [{ "indexed": false, "internalType": "address", "name": "account", "type": "address" }], "name": "Unpaused", "type": "event" },
  { "inputs": [], "name": "BPS_DENOMINATOR", "outputs": [{ "internalType": "uint16", "name": "", "type": "uint16" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "ORDER_TYPEHASH", "outputs": [{ "internalType": "bytes32", "name": "", "type": "bytes32" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "PRICE_DECIMALS", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
  { "inputs": [{ "components": [{ "internalType": "address", "name": "maker", "type": "address" }, { "internalType": "address", "name": "base", "type": "address" }, { "internalType": "address", "name": "quote", "type": "address" }, { "internalType": "uint8", "name": "side", "type": "uint8" }, { "internalType": "uint256", "name": "amount", "type": "uint256" }, { "internalType": "uint256", "name": "price", "type": "uint256" }, { "internalType": "uint256", "name": "expiry", "type": "uint256" }, { "internalType": "uint256", "name": "nonce", "type": "uint256" }], "internalType": "struct OrderBook.Order", "name": "o", "type": "tuple" }], "name": "cancelOrder", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [{ "internalType": "uint256", "name": "newMinNonce", "type": "uint256" }], "name": "cancelUpTo", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [], "name": "eip712Domain", "outputs": [{ "internalType": "bytes1", "name": "fields", "type": "bytes1" }, { "internalType": "string", "name": "name", "type": "string" }, { "internalType": "string", "name": "version", "type": "string" }, { "internalType": "uint256", "name": "chainId", "type": "uint256" }, { "internalType": "address", "name": "verifyingContract", "type": "address" }, { "internalType": "bytes32", "name": "salt", "type": "bytes32" }, { "internalType": "uint256[]", "name": "extensions", "type": "uint256[]" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "feeBps", "outputs": [{ "internalType": "uint16", "name": "", "type": "uint16" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "feeRecipient", "outputs": [{ "internalType": "address", "name": "", "type": "address" }], "stateMutability": "view", "type": "function" },
  { "inputs": [{ "components": [{ "internalType": "address", "name": "maker", "type": "address" }, { "internalType": "address", "name": "base", "type": "address" }, { "internalType": "address", "name": "quote", "type": "address" }, { "internalType": "uint8", "name": "side", "type": "uint8" }, { "internalType": "uint256", "name": "amount", "type": "uint256" }, { "internalType": "uint256", "name": "price", "type": "uint256" }, { "internalType": "uint256", "name": "expiry", "type": "uint256" }, { "internalType": "uint256", "name": "nonce", "type": "uint256" }], "internalType": "struct OrderBook.Order", "name": "o", "type": "tuple" }, { "internalType": "bytes", "name": "sig", "type": "bytes" }, { "internalType": "uint256", "name": "fillAmountBase", "type": "uint256" }], "name": "fillOrder", "outputs": [{ "internalType": "uint256", "name": "filledBaseOut", "type": "uint256" }, { "internalType": "uint256", "name": "filledQuoteOut", "type": "uint256" }, { "internalType": "uint256", "name": "feeQuoteOut", "type": "uint256" }], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [{ "components": [{ "internalType": "address", "name": "maker", "type": "address" }, { "internalType": "address", "name": "base", "type": "address" }, { "internalType": "address", "name": "quote", "type": "address" }, { "internalType": "uint8", "name": "side", "type": "uint8" }, { "internalType": "uint256", "name": "amount", "type": "uint256" }, { "internalType": "uint256", "name": "price", "type": "uint256" }, { "internalType": "uint256", "name": "expiry", "type": "uint256" }, { "internalType": "uint256", "name": "nonce", "type": "uint256" }], "internalType": "struct OrderBook.Order[]", "name": "orders", "type": "tuple[]" }, { "internalType": "bytes[]", "name": "sigs", "type": "bytes[]" }, { "internalType": "uint256[]", "name": "fillAmountsBase", "type": "uint256[]" }], "name": "fillOrders", "outputs": [{ "internalType": "uint256", "name": "totalBase", "type": "uint256" }, { "internalType": "uint256", "name": "totalQuote", "type": "uint256" }, { "internalType": "uint256", "name": "totalFee", "type": "uint256" }], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [{ "internalType": "address", "name": "base", "type": "address" }, { "internalType": "address", "name": "quote", "type": "address" }], "name": "pairKey", "outputs": [{ "internalType": "bytes32", "name": "", "type": "bytes32" }], "stateMutability": "pure", "type": "function" },
];

// Market presets (fallback)
const MARKETS = [
  {
    id: 'ADOG/WBNB',
    base: { symbol: 'ADOG', address: '0x87241b1b7fd82cf4f4842f195909ca69aa6e4444', decimals: 18 },
    quote: { symbol: 'WBNB', address: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c', decimals: 18 },
  },
  {
    id: 'WBNB/USDT',
    base: { symbol: 'WBNB', address: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c', decimals: 18 },
    quote: { symbol: 'USDT', address: '0x55d398326f99059ff775485246999027b3197955', decimals: 18 },
  },
  {
    id: 'WBNB/USDC',
    base: { symbol: 'WBNB', address: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c', decimals: 18 },
    quote: { symbol: 'USDC', address: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', decimals: 18 },
  },
  {
    id: 'CAKE/USDT',
    base: { symbol: 'CAKE', address: '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82', decimals: 18 },
    quote: { symbol: 'USDT', address: '0x55d398326f99059ff775485246999027b3197955', decimals: 18 },
  },
  {
    id: 'USDT/WBNB',
    base: { symbol: 'USDT', address: '0x55d398326f99059ff775485246999027b3197955', decimals: 18 },
    quote: { symbol: 'WBNB', address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', decimals: 18 },
  },
];

// Theming and responsive styles
const makeStyles = (theme, isMobile) => {
  const dark = theme === 'dark';
  const colors = dark
    ? {
        pageBg: 'radial-gradient(1200px 600px at 10% -20%, rgba(0,180,255,0.15), transparent),\n                radial-gradient(900px 500px at 90% 0%, rgba(150,0,255,0.15), transparent),\n                linear-gradient(180deg, #0b0f1a 0%, #0a0d16 60%, #090b12 100%)',
        text: '#e6eefc',
        title: '#cfe1ff',
        cardBg: 'linear-gradient(180deg, rgba(14,20,34,0.7), rgba(11,15,26,0.7))',
        border: 'rgba(255,255,255,0.08)',
        subtleBorder: 'rgba(255,255,255,0.06)',
        inputBg: 'rgba(255,255,255,0.04)',
        inputBorder: 'rgba(255,255,255,0.12)',
        hint: 'rgba(230,238,252,0.75)',
        buttonBg: 'rgba(9, 14, 26, 0.6)',
        buttonText: '#e6eefc',
        statusBorder: 'rgba(0,224,255,0.25)',
        statusText: '#bfe7ff',
        link: '#61dafb',
        up: '#2bd67c',
        down: '#ff5c5c'
      }
    : {
        pageBg: 'radial-gradient(1200px 600px at 10% -20%, rgba(0,180,255,0.08), transparent),\n                radial-gradient(900px 500px at 90% 0%, rgba(150,0,255,0.08), transparent),\n                linear-gradient(180deg, #f9fbff 0%, #f2f6ff 60%, #eaf1ff 100%)',
        text: '#0b1220',
        title: '#1c2b4d',
        cardBg: 'linear-gradient(180deg, rgba(255,255,255,0.88), rgba(255,255,255,0.8))',
        border: 'rgba(0,0,0,0.08)',
        subtleBorder: 'rgba(0,0,0,0.06)',
        inputBg: 'rgba(255,255,255,0.9)',
        inputBorder: 'rgba(0,0,0,0.12)',
        hint: 'rgba(11,18,32,0.65)',
        buttonBg: 'rgba(255,255,255,0.85)',
        buttonText: '#0b1220',
        statusBorder: 'rgba(0,120,220,0.2)',
        statusText: '#0a3c64',
        link: '#0969da',
        up: '#0a8f4a',
        down: '#d23b3b'
      };

  return {
    page: { minHeight: '100vh', background: colors.pageBg, color: colors.text },
    container: { maxWidth: 1280, margin: '0 auto', padding: isMobile ? '20px 12px' : '32px 16px' },
    navbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, gap: 8 },
    navbarRight: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' },
    brand: { fontSize: 22, fontWeight: 700, letterSpacing: 0.5, display: 'flex', alignItems: 'center', gap: 10 },
    brandBadge: { width: 10, height: 10, borderRadius: 12, background: 'linear-gradient(45deg,#00e0ff,#7b61ff)', boxShadow: '0 0 12px #48f' },
    button: {
      padding: '12px 16px', borderRadius: 14, border: `1px solid ${colors.inputBorder}`, background: colors.buttonBg, color: colors.buttonText, cursor: 'pointer', backdropFilter: 'blur(12px)', boxShadow: '0 8px 24px rgba(0,0,0,0.18)', transition: 'transform .15s ease, box-shadow .15s ease'
    },
    buttonPrimary: { background: dark ? 'linear-gradient(135deg, #00e0ff 0%, #7b61ff 100%)' : 'linear-gradient(135deg, #0aa7ff 0%, #7b61ff 100%)', border: 'none', boxShadow: dark ? '0 10px 30px rgba(0,224,255,0.22)' : '0 10px 24px rgba(10,167,255,0.22)', color: '#fff' },
    grid3: { display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '240px 1fr 360px', gap: 16 },
    card: { background: colors.cardBg, border: `1px solid ${colors.border}`, borderRadius: 20, padding: 18, boxShadow: dark ? '0 12px 48px rgba(0,0,0,0.35)' : '0 10px 28px rgba(0,0,0,0.10)', backdropFilter: 'blur(12px)' },
    sectionTitle: { fontWeight: 800, letterSpacing: 0.3, fontSize: 18, marginBottom: 10, color: colors.title },
    label: { fontSize: 12, opacity: 0.85, marginBottom: 6, color: colors.hint },
    hint: { fontSize: 12, color: colors.hint },
    input: { width: '100%', background: colors.inputBg, border: `1px solid ${colors.inputBorder}`, color: colors.text, padding: '10px 12px', borderRadius: 10, outline: 'none' },
    textarea: { width: '100%', background: colors.inputBg, border: `1px solid ${colors.inputBorder}`, color: colors.text, padding: '10px 12px', borderRadius: 10, outline: 'none', resize: 'vertical' },
    select: { width: '100%', background: colors.inputBg, border: `1px solid ${colors.inputBorder}`, color: colors.text, padding: '10px 12px', borderRadius: 10, outline: 'none' },
    table: { width: '100%', borderCollapse: 'separate', borderSpacing: 0 },
    th: { textAlign: 'left', fontWeight: 600, fontSize: 13, padding: '8px 6px', color: colors.title, borderBottom: `1px solid ${colors.border}` },
    td: { fontSize: 13, padding: '8px 6px', borderBottom: `1px solid ${colors.subtleBorder}`, color: colors.text },
    status: { marginTop: 12, padding: 10, borderRadius: 10, border: `1px solid ${colors.statusBorder}`, background: dark ? 'linear-gradient(135deg, rgba(0,224,255,0.12), rgba(123,97,255,0.12))' : 'linear-gradient(135deg, rgba(0,150,255,0.10), rgba(150,120,255,0.10))', color: colors.statusText },
    link: { color: colors.link, textDecoration: 'none', fontWeight: 600 },
    // Mobile specific
    tabs: { display: 'flex', gap: 8, marginBottom: 8 },
    tabBtn: (active) => ({
      padding: '10px 14px', borderRadius: 10, border: `1px solid ${active ? colors.statusBorder : colors.inputBorder}`,
      background: active ? (dark ? 'linear-gradient(135deg, rgba(0,224,255,0.18), rgba(123,97,255,0.18))' : 'linear-gradient(135deg, rgba(0,140,255,0.12), rgba(123,97,255,0.12))') : colors.buttonBg,
      color: colors.buttonText, cursor: 'pointer'
    }),
    marketItem: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
    statCol: { display: 'flex', flexDirection: 'column', textAlign: 'right', minWidth: 80, gap: 2 },
    statPrice: { fontWeight: 600 },
    statVol: { fontSize: 12, opacity: 0.85 },
    statChange: (val) => ({ fontSize: 12, color: val >= 0 ? colors.up : colors.down }),
    upColor: colors.up,
    downColor: colors.down
  };
};

// Token logo helpers
const toChecksum = (a) => { try { return getAddress(a); } catch { return a; } };
const logoURL = (addr) => `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/smartchain/assets/${toChecksum(addr)}/logo.png`;
const placeholderLogo = (symbol='TOK') => {
  const sym = (symbol || 'TOK').slice(0, 3).toUpperCase();
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'>
    <rect width='100%' height='100%' fill='#0b0f1a'/>
    <circle cx='32' cy='32' r='28' fill='#1c2538'/>
    <text x='50%' y='54%' text-anchor='middle' font-size='20' fill='#cfe1ff' font-family='Arial, sans-serif'>${sym}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

function addressesEqual(a, b) {
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}
function norm(a) {
  try { return (a || '').toLowerCase(); } catch { return a; }
}

function formatNum(x, { digits = 2, trimZero = true } = {}) {
  if (x == null || isNaN(x)) return '-';
  const s = Number(x).toFixed(digits);
  return trimZero ? s.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1') : s;
}
function formatAbbrev(x) {
  if (x == null || isNaN(x)) return '-';
  const n = Number(x);
  if (n >= 1e9) return (n / 1e9).toFixed(2).replace(/\.0+$/, '') + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2).replace(/\.0+$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(2).replace(/\.0+$/, '') + 'K';
  return n.toFixed(2).replace(/\.0+$/, '');
}

function formatBalanceShort(v) {
  try {
    const n = Number(v);
    if (!isFinite(n)) return '0.0000';
    if (Math.abs(n) >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
    return n.toFixed(4);
  } catch { return '0.0000'; }
}

function MarketList({ markets, selectedIndex, onSelect, tokenLogos, s, statsMap, isMobile, onMobileOpen }) {
  return (
    <div style={s.card}>
      <div style={s.sectionTitle}>Markets</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {markets.map((m, i) => {
          const key = `${norm(m.base.address)}_${norm(m.quote.address)}`;
          const st = statsMap[key] || {};
          return (
            <button
              key={m.id}
              onClick={() => { onSelect(i); if (isMobile && onMobileOpen) onMobileOpen(); }}
              style={{
                ...s.button,
                justifyContent: 'space-between',
                textAlign: 'left',
                background: i === selectedIndex ? 'linear-gradient(135deg, rgba(0,224,255,0.25), rgba(123,97,255,0.25))' : s.button.background
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <img
                  alt={m.base.symbol}
                  src={tokenLogos[norm(m.base.address)] || logoURL(m.base.address)}
                  onError={(e) => { e.currentTarget.src = placeholderLogo(m.base.symbol); }}
                  style={{ width: 20, height: 20, borderRadius: 10, border: '1px solid rgba(255,255,255,0.12)' }}
                />
                <img
                  alt={m.quote.symbol}
                  src={tokenLogos[norm(m.quote.address)] || logoURL(m.quote.address)}
                  onError={(e) => { e.currentTarget.src = placeholderLogo(m.quote.symbol); }}
                  style={{ width: 20, height: 20, borderRadius: 10, border: '1px solid rgba(255,255,255,0.12)' }}
                />
                <div>
                  <div style={{ fontWeight: 700 }}>{m.id}</div>
                  <div style={{ fontSize: 12, opacity: 0.75 }}>{m.base.symbol} · {m.quote.symbol}</div>
                </div>
              </div>
              <div style={s.statCol}>
                <span style={s.statPrice}>{formatNum(st.lastPrice, { digits: 2 })} USD</span>
                <span style={s.statVol}>Vol 24h: {formatAbbrev(st.volumeQuote24h)} USD</span>
                <span style={s.statChange(st.change24h)}>{st.change24h == null ? '-' : `${formatNum(st.change24h, { digits: 2 })}%`}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function GeckoTerminalChart({ baseAddress, poolId, height = 380 }) {
  const base = (baseAddress || '').toLowerCase();
  const src = poolId
    ? `https://www.geckoterminal.com/bsc/pools/${poolId}?embed=1&info=0&swaps=0&holders=0&chart=1`
    : `https://www.geckoterminal.com/bsc/tokens/${base}?embed=1&info=0&swaps=0&holders=0&chart=1`;
  return (
    <iframe
      title="GeckoTerminal Chart"
      src={src}
      style={{ width: '100%', height, border: 0, borderRadius: 12 }}
      frameBorder="0"
      allow="clipboard-write;"
    />
  );
}

function OrderBookTables({ bids, asks, baseSymbol, quoteSymbol, baseDecimals, s, isMobile, twoCols = false }) {
  const fmt = (x, d=baseDecimals) => {
    try { return formatUnits(x, d); } catch { return String(x); }
  };
  return (
    <div style={{ display: 'grid', gridTemplateColumns: twoCols ? '1fr 1fr' : (isMobile ? '1fr' : '1fr 1fr'), gap: 12 }}>
      <div style={s.card}>
        <div style={s.sectionTitle}>Asks (SELL)</div>
        <div style={{ maxHeight: 260, overflowY: 'auto' }}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Price ({quoteSymbol})</th>
                <th style={s.th}>Amount ({baseSymbol})</th>
              </tr>
            </thead>
            <tbody>
              {asks.length === 0 ? (
                <tr><td style={s.td} colSpan={2}>
                  <span style={s.hint}>No asks yet.</span>
                </td></tr>
              ) : asks.map((o, i) => (
                <tr key={o.id + ':' + i} style={{ color: '#ff5c5c' }}>
                  <td style={{ ...s.td, color: s.downColor }}>{formatUnits((o.price ?? o.order?.price ?? 0), 18)}</td>
                  <td style={{ ...s.td, color: s.downColor }}>{fmt(o.remaining ?? o.amount ?? o.order?.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div style={s.card}>
        <div style={s.sectionTitle}>Bids (BUY)</div>
        <div style={{ maxHeight: 260, overflowY: 'auto' }}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Price ({quoteSymbol})</th>
                <th style={s.th}>Amount ({baseSymbol})</th>
              </tr>
            </thead>
            <tbody>
              {bids.length === 0 ? (
                <tr><td style={s.td} colSpan={2}>
                  <span style={s.hint}>No bids yet.</span>
                </td></tr>
              ) : bids.map((o, i) => (
                <tr key={o.id + ':' + i} style={{ color: '#2bd67c' }}>
                  <td style={{ ...s.td, color: s.upColor }}>{formatUnits((o.price ?? o.order?.price ?? 0), 18)}</td>
                  <td style={{ ...s.td, color: s.upColor }}>{fmt(o.remaining ?? o.amount ?? o.order?.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function useLocalStorage(key, initial) {
  const [val, setVal] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
  }, [key, val]);
  return [val, setVal];
}

export default function OrderBookUI() {
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [account, setAccount] = useState('');
  const [chainId, setChainId] = useState(0);
  const { open } = useWeb3Modal();
  const { address, isConnected } = useWeb3ModalAccount();
  const { walletProvider } = useWeb3ModalProvider();

  const [markets, setMarkets] = useState(MARKETS);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selected = markets[selectedIndex] || markets[0] || MARKETS[0];
  const [tokenLogos, setTokenLogos] = useState({});

  // Theme + responsiveness
  const [theme, setTheme] = useLocalStorage('ui:theme', 'dark');
  const [isMobile, setIsMobile] = useState(false);
  const [mobileView, setMobileView] = useState('list'); // 'list' | 'detail'
  const [activeTab, setActiveTab] = useState('chart'); // 'chart' | 'trade'
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 900px)');
    const apply = () => setIsMobile(mql.matches);
    apply();
    try { mql.addEventListener ? mql.addEventListener('change', apply) : mql.addListener(apply); } catch {}
    return () => { try { mql.removeEventListener ? mql.removeEventListener('change', apply) : mql.removeListener(apply); } catch {} };
  }, []);
  useEffect(() => {
    if (isMobile) setMobileView('list');
  }, [isMobile]);
  const s = useMemo(() => makeStyles(theme, isMobile), [theme, isMobile]);

  // Maker form
  const [side, setSide] = useState(0); // 0 SELL, 1 BUY
  const [amountBase, setAmountBase] = useState('');
  const [priceHuman, setPriceHuman] = useState(''); // quote per base
  const [expiryMinutes, setExpiryMinutes] = useState('60');
  const [nonce, setNonce] = useState('1');
  
  // Approvals / taker
  const [approveTokenAddr, setApproveTokenAddr] = useState('');
  const [approveAmount, setApproveAmount] = useState('');
  const [cancelUpToNonce, setCancelUpToNonce] = useState('');
  const [balanceBase, setBalanceBase] = useState('0');
  const [balanceQuote, setBalanceQuote] = useState('0');

  const [status, setStatus] = useState('');
  const [lastTxHash, setLastTxHash] = useState('');
  const [recentFills, setRecentFills] = useLocalStorage('orderbook:recentFills', []);
  const [myOrders, setMyOrders] = useLocalStorage('orderbook:myOrders', []);

  const orderbook = useMemo(() => {
    const p = signer ?? provider;
    return p ? new Contract(ORDERBOOK_ADDRESS, ORDERBOOK_ABI, p) : null;
  }, [provider, signer]);

  // Wallet setup
  useEffect(() => {
    const setup = async () => {
      try {
        if (walletProvider) {
          const prov = new BrowserProvider(walletProvider);
          setProvider(prov);
          const net = await prov.getNetwork();
          setChainId(Number(net.chainId));
          if (isConnected && address) {
            const s = await prov.getSigner();
            setSigner(s);
            setAccount(address);
          } else {
            setSigner(null);
            setAccount('');
          }
        } else if (window.ethereum) {
          const prov = new BrowserProvider(window.ethereum);
          setProvider(prov);
          const net = await prov.getNetwork();
          setChainId(Number(net.chainId));
          const accs = await prov.listAccounts();
          if (accs.length > 0) {
            const s = await prov.getSigner();
            setSigner(s);
            setAccount(accs[0].address);
          }
        }
      } catch (e) { console.error(e); }
    };
    setup();
  }, [walletProvider, isConnected, address]);

  const connect = async () => { try { await open(); } catch (e) { console.error(e); } };
  const getErc20 = (addr) => new Contract(addr, ERC20_ABI, signer ?? provider);
  const isBsc = chainId === 56;
  const explorerBase = useMemo(() => (chainId === 56 ? 'https://bscscan.com' : (chainId === 97 ? 'https://testnet.bscscan.com' : 'https://bscscan.com')), [chainId]);
  useEffect(() => { try { console.log('[DEBUG] explorer base', explorerBase, 'chainId', chainId); } catch {} }, [explorerBase, chainId]);
  useEffect(() => { try { console.log('[DEBUG] lastTxHash changed', lastTxHash, 'status', status); } catch {} }, [lastTxHash, status]);

  // Relayer configuration
  let RELAYER_URL = (process.env.REACT_APP_RELAYER_URL || '').trim();
  const isBrowser = typeof window !== 'undefined';
  if (isBrowser) {
    const host = window.location.hostname;
    const isLocalHost = host === 'localhost' || host === '127.0.0.1';
    const envIsLocal = /^(http|https):\/\/(localhost|127\.0\.0\.1)(:\\d+)?/i.test(RELAYER_URL);
    // In production (non-localhost), ignore env if it points to localhost; default to same-origin
    if (!RELAYER_URL || (!isLocalHost && envIsLocal)) {
      RELAYER_URL = window.location.origin;
    }
  }
  if (!RELAYER_URL) RELAYER_URL = 'http://localhost:8080';
  const httpUrl = RELAYER_URL.replace(/\/$/, '');
  const wsUrl = httpUrl.replace(/^http(s)?:\/\//, (_m, s) => (s ? 'wss://' : 'ws://'));

  // Load dynamic markets
  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`${httpUrl}/markets`);
        if (res.ok) {
          const list = await res.json();
          if (Array.isArray(list) && list.length > 0) setMarkets(list);
        }
      } catch (e) {}
    };
    load();
  }, [httpUrl]);

  // Fetch token logos
  useEffect(() => {
    const addrs = new Set();
    for (const m of markets) {
      if (m?.base?.address) addrs.add(norm(m.base.address));
      if (m?.quote?.address) addrs.add(norm(m.quote.address));
    }
    const toFetch = Array.from(addrs).filter(a => a && !tokenLogos[a]);
    if (toFetch.length === 0) return;
    const controller = new AbortController();
    (async () => {
      for (const a of toFetch) {
        try {
          let checksum; try { checksum = getAddress(a); } catch { checksum = a; }
          const url = `https://api.geckoterminal.com/api/v2/networks/bsc/tokens/${checksum}/info`;
          const res = await fetch(url, { signal: controller.signal });
          if (!res.ok) continue;
          const json = await res.json().catch(()=>null);
          const img = json?.data?.attributes?.image_url || json?.data?.attributes?.thumbnail_url;
          if (img) setTokenLogos(prev => ({ ...prev, [a]: img }));
        } catch {} }
    })();
    return () => controller.abort();
  }, [markets, tokenLogos]);

  // Load user balances for selected tokens
  useEffect(() => {
    (async () => {
      try {
        if (!account || !(provider || signer)) { setBalanceBase('0'); setBalanceQuote('0'); return; }
        const p = signer ?? provider;
        const ercB = new Contract(selected.base.address, ERC20_ABI, p);
        const ercQ = new Contract(selected.quote.address, ERC20_ABI, p);
        const [bB, bQ] = await Promise.all([
          ercB.balanceOf(account).catch(()=>0),
          ercQ.balanceOf(account).catch(()=>0)
        ]);
        setBalanceBase(formatUnits(bB, selected.base.decimals));
        setBalanceQuote(formatUnits(bQ, selected.quote.decimals));
      } catch (e) { try { console.log('[DEBUG] balance error', e); } catch {} }
    })();
  }, [account, provider, signer, selected]);

  // Market stats for list (price, volume, change)
  const [statsMap, setStatsMap] = useState({}); // key: base_quote -> { lastPrice, volumeQuote24h, change24h }
  useEffect(() => {
    let timer;
    const load = async () => {
      try {
        const res = await fetch(`${httpUrl}/market-stats`);
        if (!res.ok) return;
        const arr = await res.json();
        const map = {};
        if (Array.isArray(arr)) {
          for (const it of arr) {
            const key = `${norm(it.base)}_${norm(it.quote)}`;
            map[key] = it;
          }
        } else if (arr && arr.base && arr.quote) {
          const key = `${norm(arr.base)}_${norm(arr.quote)}`;
          map[key] = arr;
        }
        setStatsMap(map);
      } catch {}
      timer = setTimeout(load, 30000);
    };
    load();
    return () => { if (timer) clearTimeout(timer); };
  }, [httpUrl]);

  // Orderbook and trades
  const [bids, setBids] = useState([]);
  const [asks, setAsks] = useState([]);

  const seedOrderbook = useCallback(async () => {
    try {
      const res = await fetch(`${httpUrl}/orderbook?base=${selected.base.address}&quote=${selected.quote.address}`);
      const data = await res.json();
      const filterActive = (arr) => (Array.isArray(arr) ? arr.filter(r => { try { return toBigInt(r.remaining ?? r.amount ?? '0') > toBigInt(0); } catch { return true; } }) : []);
      setBids(filterActive(data.bids));
      setAsks(filterActive(data.asks));
    } catch (e) { console.error(e); }
  }, [httpUrl, selected]);

  useEffect(() => { seedOrderbook(); }, [seedOrderbook]);

  useEffect(() => {
    let ws;
    try {
      ws = new WebSocket(wsUrl);
      ws.onopen = () => { ws.send(JSON.stringify({ op: 'subscribe', base: selected.base.address, quote: selected.quote.address })); };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.op === 'OrderAdded' || msg.op === 'OrderUpdated' || msg.op === 'OrderRemoved') {
            seedOrderbook();
          } else if (msg.op === 'Trade') {
            const txh = msg.tx || msg.transactionHash || msg.hash || (msg.transaction && msg.transaction.hash);
            setRecentFills((prev) => [ { ...msg, tx: txh, base: msg.base || selected.base.address, quote: msg.quote || selected.quote.address, time: msg.time || Date.now() }, ...prev ].slice(0, 200));
            try {
              const isMaker = addressesEqual(account, msg.maker);
              const isTaker = addressesEqual(account, msg.taker);
              console.log('[DEBUG] WS Trade', { txh, msg, account, isMaker, isTaker });
              if (txh && (isMaker || isTaker)) {
                setLastTxHash(txh);
                setStatus(prev => {
                  try {
                    if (!prev || String(prev).indexOf(txh.slice(0,8)) === -1) {
                      return 'Trade confirmed: ' + txh.slice(0,10) + '...';
                    }
                    return prev;
                  } catch {
                    return 'Trade confirmed: ' + txh.slice(0,10) + '...';
                  }
                });
              }
            } catch {}
          }
        } catch {}
      };
    } catch (e) { console.error(e); }
    return () => { try { ws && ws.close(); } catch {} };
  }, [wsUrl, selected, seedOrderbook, setRecentFills, account]);

  
  // Place (sign) order
  const signOrder = async () => {
    try {
      if (!signer) return alert('Connect wallet');
      const amt = parseUnits(String(amountBase || '0'), selected.base.decimals);
      const px = parseUnits(String(priceHuman || '0'), 18);
      const exp = Math.floor(Date.now() / 1000) + Math.max(1, parseInt(expiryMinutes || '0', 10)) * 60;

      const order = { maker: norm(account), base: norm(selected.base.address), quote: norm(selected.quote.address), side: Number(side), amount: amt, price: px, expiry: toBigInt(exp), nonce: toBigInt(nonce || '0') };
      const domain = { name: 'OrderBook', version: '1', chainId: toBigInt(chainId), verifyingContract: norm(ORDERBOOK_ADDRESS) };
      const types = { Order: [ { name: 'maker', type: 'address' }, { name: 'base', type: 'address' }, { name: 'quote', type: 'address' }, { name: 'side', type: 'uint8' }, { name: 'amount', type: 'uint256' }, { name: 'price', type: 'uint256' }, { name: 'expiry', type: 'uint256' }, { name: 'nonce', type: 'uint256' } ] };

      setStatus('Signing EIP-712 order...');
      const signature = await signer.signTypedData(domain, types, order);

      try {
        const wire = { maker: norm(order.maker), base: norm(order.base), quote: norm(order.quote), side: Number(order.side), amount: String(order.amount), price: String(order.price), expiry: String(order.expiry), nonce: String(order.nonce) };
        const res = await fetch(`${httpUrl}/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order: wire, signature }) });
        if (!res.ok) { const err = await res.json().catch(()=>({})); throw new Error(err.error || 'relayer rejected order'); }
        setStatus('Order submitted to relayer');
        try { await seedOrderbook(); } catch {}
      } catch (e) { console.error(e); setStatus('Relayer submit error: ' + (e?.message || '')); }

      let orderHash = '0x';
      try { orderHash = await orderbook.orderHash(order); } catch {}

      const entry = { id: orderHash, order, signature, baseSymbol: selected.base.symbol, quoteSymbol: selected.quote.symbol, baseDecimals: selected.base.decimals, quoteDecimals: selected.quote.decimals, createdAt: Date.now() };
      setMyOrders((prev) => [entry, ...prev].slice(0, 500));
      setStatus('Order signed');
    } catch (e) { console.error(e); setStatus('Error: ' + (e?.shortMessage || e?.message || '')); }
  };

  const approveToken = async () => {
    try {
      if (!signer) return alert('Connect wallet');
      if (!approveTokenAddr) return alert('Enter token to approve');
      const erc = getErc20(approveTokenAddr);
      const dec = await erc.decimals().catch(() => 18);
      const amt = parseUnits(String(approveAmount || '0'), Number(dec));
      setStatus('Sending approve...');
      const tx = await erc.connect(signer).approve(ROUTER_ADDRESS, amt);
      await tx.wait();
      setStatus('Approve confirmed');
    } catch (e) { console.error(e); setStatus('Error: ' + (e?.shortMessage || e?.message || '')); }
  };

  
  const doCancelOrder = async (entry) => {
    try {
      if (!signer) return alert('Connect wallet');
      if (!entry?.order) return alert('Missing order');
      setStatus('Sending cancelOrder...');
      const tx = await orderbook.connect(signer).cancelOrder({ maker: norm(entry.order.maker), base: norm(entry.order.base), quote: norm(entry.order.quote), side: Number(entry.order.side), amount: toBigInt(entry.order.amount), price: toBigInt(entry.order.price), expiry: toBigInt(entry.order.expiry), nonce: toBigInt(entry.order.nonce) });
      const rcpt = await tx.wait();
      setStatus('Cancelled. Tx: ' + rcpt?.hash);
      try { await seedOrderbook(); } catch {}
    } catch (e) { console.error(e); setStatus('Error: ' + (e?.shortMessage || e?.message || '')); }
  };

  const doCancelUpTo = async () => {
    try {
      if (!signer) return alert('Connect wallet');
      const n = String(cancelUpToNonce || '');
      if (!n) return alert('Enter nonce');
      setStatus('Sending cancelUpTo...');
      const tx = await orderbook.connect(signer).cancelUpTo(toBigInt(n));
      const rcpt = await tx.wait();
      setStatus('CancelUpTo confirmed. Tx: ' + rcpt?.hash);
      try { await seedOrderbook(); } catch {}
    } catch (e) { console.error(e); setStatus('Error: ' + (e?.shortMessage || e?.message || '')); }
  };

  // Derived views
  const recentForMarket = useMemo(() => recentFills.filter(e => addressesEqual(e.base, selected.base.address) && addressesEqual(e.quote, selected.quote.address)), [recentFills, selected]);
  const totalQuotePreview = useMemo(() => {
    try {
      const amt = parseUnits(String(amountBase || '0'), selected.base.decimals);
      const px = parseUnits(String(priceHuman || '0'), 18);
      const q = (toBigInt(amt) * toBigInt(px)) / toBigInt(parseUnits('1', 18));
      return formatUnits(q, selected.quote.decimals);
    } catch { return '0'; }
  }, [amountBase, priceHuman, selected]);
  const myLocalForMarket = useMemo(() => myOrders.filter(o => o.order && addressesEqual(o.order.base, selected.base.address) && addressesEqual(o.order.quote, selected.quote.address) && addressesEqual(o.order.maker, account)), [myOrders, selected, account]);

  const formatTimeAgo = (ms) => {
    const s = Math.max(1, Math.floor((Date.now() - ms) / 1000));
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
  };

  // Render
  return (
    <div style={s.page}>
      <div style={s.container}>
        <div style={s.navbar}>
          <div style={s.brand}>
            <span style={s.brandBadge} />
            OrderBook
          </div>
          <div style={s.navbarRight}>
            <button style={s.button} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
              {theme === 'dark' ? 'Light Theme' : 'Dark Theme'}
            </button>
            {!isBsc && (
              <div style={{ ...s.status, padding: '6px 10px' }}>Switch to BSC (56). Current: {chainId || '-'}</div>
            )}
            <button style={{ ...s.button, ...s.buttonPrimary }} onClick={connect}>
              {account ? `${account.slice(0,6)}...${account.slice(-4)}` : 'Connect Wallet'}
            </button>
          </div>
        </div>

        {status && (
          <div style={s.status}>
            {status}
            {lastTxHash ? (
              <>
                {' '}·{' '}
                <a href={`${explorerBase}/tx/${lastTxHash}`} target="_blank" rel="noreferrer" style={s.link}>View on BscScan</a>
              </>
            ) : null}
          </div>
        )}

        {!isMobile && (
          <div style={s.grid3}>
            <MarketList markets={markets} selectedIndex={selectedIndex} onSelect={setSelectedIndex} tokenLogos={tokenLogos} s={s} statsMap={statsMap} isMobile={false} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={s.card}>
                <div style={s.sectionTitle}>Chart — {selected.id}</div>
                <GeckoTerminalChart baseAddress={selected.base.address} height={380} />
              </div>

              <OrderBookTables bids={bids} asks={asks} baseSymbol={selected.base.symbol} quoteSymbol={selected.quote.symbol} baseDecimals={selected.base.decimals} s={s} isMobile={false} />

              <div style={s.card}>
                <div style={s.sectionTitle}>Recent Trades — {selected.id}</div>
                {recentForMarket.length === 0 ? (
                  <div style={s.hint}>No fills yet.</div>
                ) : (
                  <div style={{ maxHeight: 240, overflowY: 'auto' }}>
                    <table style={s.table}>
                      <thead>
                        <tr>
                          <th style={s.th}>Side</th>
                          <th style={s.th}>Price ({selected.quote.symbol})</th>
                          <th style={s.th}>Base</th>
                          <th style={s.th}>Quote</th>
                          <th style={s.th}>Tx</th>
                          <th style={s.th}>When</th>
                        </tr>
                      </thead>
                      <tbody>
                        {recentForMarket.map((e, idx) => {
                          const price = (() => {
                            try { const fq = parseFloat(formatUnits(e.fillQuote, selected.quote.decimals)); const fb = parseFloat(formatUnits(e.fillBase, selected.base.decimals)); return fb > 0 ? (fq / fb).toFixed(6) : '-'; } catch { return '-'; }
                          })();
                          const txh = e.tx || e.transactionHash || e.hash || (e.transaction && e.transaction.hash);
                          return (
                            <tr key={(txh || '') + idx}>
                              <td style={{ ...s.td, color: e.side === 0 ? '#ff5c5c' : '#2bd67c' }}>{e.side === 0 ? 'SELL' : 'BUY'}</td>
                              <td style={s.td}>{price}</td>
                              <td style={s.td}>{formatUnits(e.fillBase, selected.base.decimals)} {selected.base.symbol}</td>
                              <td style={s.td}>{formatUnits(e.fillQuote, selected.quote.decimals)} {selected.quote.symbol}</td>
                              <td style={{ ...s.td, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {txh ? <a href={`${explorerBase}/tx/${txh}`} target="_blank" rel="noreferrer" style={s.link}>{txh.slice(0,8)}...</a> : '-'}
                              </td>
                              <td style={s.td}>{formatTimeAgo(e.time)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={s.card}>
                <div style={s.sectionTitle}>Place Order — {selected.id}</div>
                <div style={{ ...s.hint, marginBottom: 8 }}>
                  Balances: {formatBalanceShort(balanceBase)} {selected.base.symbol} · {formatBalanceShort(balanceQuote)} {selected.quote.symbol}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <div style={s.label}>Side</div>
                    <select style={s.select} value={side} onChange={e => setSide(Number(e.target.value))}>
                      <option value={0}>SELL (maker sells {selected.base.symbol})</option>
                      <option value={1}>BUY (maker buys {selected.base.symbol})</option>
                    </select>
                  </div>
                  <div>
                    <div style={s.label}>Price ({selected.quote.symbol} per {selected.base.symbol})</div>
                    <input style={s.input} placeholder={`e.g., 250`} value={priceHuman} onChange={e=>setPriceHuman(e.target.value)} />
                  </div>
                  <div>
                    <div style={s.label}>Amount ({selected.base.symbol})</div>
                    <input style={s.input} placeholder={`e.g., 1.0`} value={amountBase} onChange={e=>setAmountBase(e.target.value)} />
                  </div>
                  <div>
                    <div style={s.label}>Total (quote preview)</div>
                    <input style={s.input} readOnly value={`${totalQuotePreview} ${selected.quote.symbol}`} />
                  </div>
                  <div>
                    <div style={s.label}>Expiry (minutes)</div>
                    <input style={s.input} value={expiryMinutes} onChange={e=>setExpiryMinutes(e.target.value)} />
                  </div>
                  <div>
                    <div style={s.label}>Nonce</div>
                    <input style={s.input} value={nonce} onChange={e=>setNonce(e.target.value)} />
                  </div>
                </div>
                <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button style={{ ...s.button, ...s.buttonPrimary }} onClick={signOrder} disabled={!account}>Place Order</button>
                </div>
              </div>

              <div style={s.card}>
                <div style={s.sectionTitle}>Approvals</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                  <div>
                    <div style={s.label}>Token</div>
                    <input style={s.input} placeholder="0x..." value={approveTokenAddr} onChange={e=>setApproveTokenAddr(e.target.value)} />
                  </div>
                  <div>
                    <div style={s.label}>Amount (human)</div>
                    <input style={s.input} placeholder="e.g., 1000" value={approveAmount} onChange={e=>setApproveAmount(e.target.value)} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'end' }}>
                    <button style={s.button} onClick={approveToken} disabled={!account}>Approve</button>
                  </div>
                </div>
                <div style={{ ...s.hint, marginTop: 8 }}>
                  Approve the router {ROUTER_ADDRESS.slice(0,6)}...{ROUTER_ADDRESS.slice(-4)} for the token you will pay as taker:
                  SELL maker ➜ taker pays {selected.quote.symbol}; BUY maker ➜ taker pays {selected.base.symbol}.
                </div>
              </div>

              
              <div style={s.card}>
                <div style={s.sectionTitle}>My Orders (local)</div>
                {myLocalForMarket.length === 0 ? (
                  <div style={s.hint}>No local orders for this market.</div>
                ) : (
                  <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                    <table style={s.table}>
                      <thead>
                        <tr>
                          <th style={s.th}>Side</th>
                          <th style={s.th}>Price</th>
                          <th style={s.th}>Amount</th>
                          <th style={s.th}>Nonce</th>
                          <th style={s.th}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {myLocalForMarket.map((e, idx) => (
                          <tr key={(e.id || '') + idx}>
                            <td style={{ ...s.td, color: e.order.side === 0 ? '#ff5c5c' : '#2bd67c' }}>{e.order.side === 0 ? 'SELL' : 'BUY'}</td>
                            <td style={s.td}>{formatUnits(e.order.price, 18)}</td>
                            <td style={s.td}>{formatUnits(e.order.amount, e.baseDecimals)}</td>
                            <td style={s.td}>{String(e.order.nonce)}</td>
                            <td style={s.td}>
                              <button style={s.button} onClick={() => doCancelOrder(e)} disabled={!account}>Cancel</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
                  <input style={s.input} placeholder="Cancel up to nonce (inclusive of all lower nonces)" value={cancelUpToNonce} onChange={e=>setCancelUpToNonce(e.target.value)} />
                  <button style={s.button} onClick={doCancelUpTo} disabled={!account}>CancelUpTo</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {isMobile && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {mobileView === 'list' && (
              <MarketList
                markets={markets}
                selectedIndex={selectedIndex}
                onSelect={setSelectedIndex}
                tokenLogos={tokenLogos}
                s={s}
                statsMap={statsMap}
                isMobile={true}
                onMobileOpen={() => { setMobileView('detail'); setActiveTab('chart'); }}
              />
            )}

            {mobileView === 'detail' && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button style={s.button} onClick={() => setMobileView('list')}>← Markets</button>
                  <div style={{ ...s.sectionTitle, margin: 0 }}>{selected.id}</div>
                </div>
                <div style={s.card}>
                  <div style={s.tabs}>
                    <button style={s.tabBtn(activeTab === 'chart')} onClick={() => setActiveTab('chart')}>Chart</button>
                    <button style={s.tabBtn(activeTab === 'trade')} onClick={() => setActiveTab('trade')}>Trade</button>
                  </div>

                  {activeTab === 'chart' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <GeckoTerminalChart baseAddress={selected.base.address} height={300} />
                      <OrderBookTables bids={bids} asks={asks} baseSymbol={selected.base.symbol} quoteSymbol={selected.quote.symbol} baseDecimals={selected.base.decimals} s={s} isMobile={true} twoCols={true} />
                    </div>
                  )}

                  {activeTab === 'trade' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <div style={{ ...s.hint }}>
                        Balances: {formatBalanceShort(balanceBase)} {selected.base.symbol} · {formatBalanceShort(balanceQuote)} {selected.quote.symbol}
                      </div>
                      <div>
                        <div style={s.label}>Side</div>
                        <select style={s.select} value={side} onChange={e => setSide(Number(e.target.value))}>
                          <option value={0}>SELL (maker sells {selected.base.symbol})</option>
                          <option value={1}>BUY (maker buys {selected.base.symbol})</option>
                        </select>
                      </div>
                      <div>
                        <div style={s.label}>Price ({selected.quote.symbol} per {selected.base.symbol})</div>
                        <input style={s.input} placeholder={`e.g., 250`} value={priceHuman} onChange={e=>setPriceHuman(e.target.value)} />
                      </div>
                      <div>
                        <div style={s.label}>Amount ({selected.base.symbol})</div>
                        <input style={s.input} placeholder={`e.g., 1.0`} value={amountBase} onChange={e=>setAmountBase(e.target.value)} />
                      </div>
                      <div>
                        <div style={s.label}>Total (quote preview)</div>
                        <input style={s.input} readOnly value={`${totalQuotePreview} ${selected.quote.symbol}`} />
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <div>
                          <div style={s.label}>Expiry (minutes)</div>
                          <input style={s.input} value={expiryMinutes} onChange={e=>setExpiryMinutes(e.target.value)} />
                        </div>
                        <div>
                          <div style={s.label}>Nonce</div>
                          <input style={s.input} value={nonce} onChange={e=>setNonce(e.target.value)} />
                        </div>
                      </div>
                      <button style={{ ...s.button, ...s.buttonPrimary }} onClick={signOrder} disabled={!account}>Place Order</button>

                      <div style={{ ...s.hint, marginTop: 8 }}>Approvals</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <input style={s.input} placeholder="Token 0x..." value={approveTokenAddr} onChange={e=>setApproveTokenAddr(e.target.value)} />
                        <input style={s.input} placeholder="Amount (human)" value={approveAmount} onChange={e=>setApproveAmount(e.target.value)} />
                      </div>
                      <button style={s.button} onClick={approveToken} disabled={!account}>Approve</button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
