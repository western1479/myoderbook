import React, { useEffect, useState } from 'react';
import CookBookUI from './components/CookBookUI';
import './App.css';

function Landing({ goTrade, theme, setTheme }) {
  const dark = (theme === 'dark');
  const isMobile = typeof window !== 'undefined' ? window.matchMedia('(max-width: 900px)').matches : false;
  const colors = dark
    ? {
        pageBg: 'radial-gradient(1200px 600px at 10% -20%, rgba(0,180,255,0.15), transparent),\n                radial-gradient(900px 500px at 90% 0%, rgba(150,0,255,0.15), transparent),\n                linear-gradient(180deg, #0b0f1a 0%, #0a0d16 60%, #090b12 100%)',
        text: '#e6eefc',
        title: '#cfe1ff',
        cardBg: 'linear-gradient(180deg, rgba(14,20,34,0.7), rgba(11,15,26,0.7))',
        border: 'rgba(255,255,255,0.08)',
        hint: 'rgba(230,238,252,0.75)',
        button: '#101828',
        buttonPrimary: 'linear-gradient(135deg, #00e0ff 0%, #7b61ff 100%)',
        accent: '#61dafb'
      }
    : {
        pageBg: '#fff', text: '#0b1220', title: '#1c2b4d', cardBg: '#fff', border: 'rgba(0,0,0,0.08)', hint: '#213', button: '#fff', buttonPrimary: '#0969da', accent: '#0969da'
      };
  const s = {
    page: { minHeight: '100vh', background: colors.pageBg, color: colors.text, overflowX: 'hidden' },
    container: { maxWidth: 1200, margin: '0 auto', padding: isMobile ? '20px 12px' : '32px 16px' },
    navbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, gap: 8, flexWrap: 'wrap' },
    brand: { display: 'flex', alignItems: 'center', gap: 10, fontWeight: 800, letterSpacing: 0.4 },
    brandBadge: { width: 10, height: 10, borderRadius: 12, background: 'linear-gradient(45deg,#00e0ff,#7b61ff)', boxShadow: '0 0 12px #48f' },
    btn: { padding: '12px 16px', borderRadius: 14, border: `1px solid ${colors.border}`, background: colors.button, color: colors.text, cursor: 'pointer' },
    btnPrimary: { background: colors.buttonPrimary, border: 'none', color: '#fff', boxShadow: '0 10px 30px rgba(0,224,255,0.22)' },
    hero: { display: 'grid', gridTemplateColumns: '1fr', gap: 24, alignItems: 'center' },
    heroRow: { display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1.2fr 1fr', gap: 24, alignItems: 'center' },
    h1: { fontSize: isMobile ? 30 : 42, lineHeight: 1.15, color: colors.title, margin: '8px 0 12px' },
    lead: { fontSize: isMobile ? 16 : 18, opacity: 0.9, maxWidth: 700 },
    ctas: { display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 16 },
    heroCard: { background: colors.cardBg, border: `1px solid ${colors.border}`, borderRadius: 20, padding: 18 },
    img: { width: '100%', borderRadius: 16, border: `1px solid ${colors.border}` },
    section: { display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: 16, marginTop: 32 },
    card: { background: colors.cardBg, border: `1px solid ${colors.border}`, borderRadius: 16, padding: 18, minHeight: 140 },
    h3: { margin: '0 0 6px', color: colors.title },
    p: { margin: 0, color: colors.hint },
    footer: { marginTop: 40, opacity: 0.7, fontSize: 13 }
  };

  return (
    <div style={s.page}>
      <div style={s.container}>
        <div style={s.navbar}>
          <div style={s.brand}>
            <span style={s.brandBadge} />
            CookBook — Trade Any Tokens on BSC
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button style={{ ...s.btn }} onClick={() => setTheme(dark ? 'light' : 'dark')}>{dark ? 'Light Theme' : 'Dark Theme'}</button>
            <a href="#/docs" style={{ ...s.btn, textDecoration: 'none', display: 'inline-block' }}>Docs</a>
            <button style={{ ...s.btn }} onClick={() => { window.open('https://bscscan.com/address/0xc42e757Cafa9219716A6b504986005319d6813eA', '_blank'); }}>Contract</button>
            <button style={{ ...s.btn, ...s.btnPrimary }} onClick={goTrade}>Trade Now</button>
          </div>
        </div>

        <div style={s.hero}>
          <div style={s.heroRow}>
            <div>
              <div style={{ fontWeight: 800, color: colors.accent, letterSpacing: 0.6 }}>Hybrid Order Book DEX</div>
              <h1 style={s.h1}>Professional order book trading for any token on BNB Smart Chain</h1>
              <p style={s.lead}>
                Sign orders off-chain. Settle on-chain. Partial fills, cancel up to nonce, and robust fee model. Non-custodial. Transparent. Live on BSC mainnet.
              </p>
              <div style={s.ctas}>
                <button style={{ ...s.btn, ...s.btnPrimary }} onClick={goTrade}>Start Trading</button>
                <a href="#/trade" style={{ ...s.btn, textDecoration: 'none' }}>View Markets</a>
              </div>
            </div>
            <div>
              <div style={s.heroCard}>
                <img src="https://isfszhhfayylydskdnue.supabase.co/storage/v1/object/public/token-logos/4327338e-a09b-45fb-bd6a-5652d595b154.png" alt="Trading" style={s.img} />
              </div>
            </div>
          </div>

          <div style={s.section}>
            <div style={s.card}>
              <h3 style={s.h3}>Any Tokens, Same Experience</h3>
              <p style={s.p}>Trade any ERC-20 on BSC with consistent order book UX. Manage bids/asks and get real-time updates.</p>
            </div>
            <div style={s.card}>
              <h3 style={s.h3}>Off-chain Orders, On-chain Settlement</h3>
              <p style={s.p}>Reduce gas until fill time. Submit EIP-712 orders and let the relayer route secure settlements to the CookBook.</p>
            </div>
            <div style={s.card}>
              <h3 style={s.h3}>Non-Custodial by Design</h3>
              <p style={s.p}>Funds remain in your wallet until matched. Approvals are explicit. Transparent fees in quote token.</p>
            </div>
          </div>

          <div style={{ ...s.section, gridTemplateColumns: '1fr 1fr' }}>
            <div style={s.card}>
              <h3 style={s.h3}>Live on BSC</h3>
              <p style={s.p}>Built for BNB Smart Chain. Low fees, fast finality, broad token ecosystem.</p>
            </div>
            <div style={s.card}>
              <h3 style={s.h3}>Built for Pros</h3>
              <p style={s.p}>Partial fills, cancel up to nonce, and event-rich settlement logs for analytics and transparency.</p>
            </div>
          </div>

          <div style={{ textAlign: 'center', marginTop: 36 }}>
            <button style={{ ...s.btn, ...s.btnPrimary, padding: '14px 20px', fontWeight: 700 }} onClick={goTrade}>Launch App</button>
          </div>

          <div style={{ ...s.footer, textAlign: 'center' }}>
            © {new Date().getFullYear()} CookBook on BSC — Trade any tokens with a professional order book experience.
          </div>
        </div>
      </div>
    </div>
  );
}

function Docs({ theme, setTheme, goTrade }) {
  const dark = (theme === 'dark');
  const isMobile = typeof window !== 'undefined' ? window.matchMedia('(max-width: 900px)').matches : false;
  const colors = dark
    ? {
        pageBg: 'radial-gradient(1200px 600px at 10% -20%, rgba(0,180,255,0.15), transparent),\n                radial-gradient(900px 500px at 90% 0%, rgba(150,0,255,0.15), transparent),\n                linear-gradient(180deg, #0b0f1a 0%, #0a0d16 60%, #090b12 100%)',
        text: '#e6eefc',
        title: '#cfe1ff',
        cardBg: 'linear-gradient(180deg, rgba(14,20,34,0.7), rgba(11,15,26,0.7))',
        border: 'rgba(255,255,255,0.08)',
        hint: 'rgba(230,238,252,0.75)',
        button: '#101828',
        buttonPrimary: 'linear-gradient(135deg, #00e0ff 0%, #7b61ff 100%)'
      }
    : {
        pageBg: '#fff', text: '#0b1220', title: '#1c2b4d', cardBg: '#fff', border: 'rgba(0,0,0,0.08)', hint: '#213', button: '#fff', buttonPrimary: '#0969da'
      };
  const s = {
    page: { minHeight: '100vh', background: colors.pageBg, color: colors.text, overflowX: 'hidden' },
    container: { maxWidth: 1000, margin: '0 auto', padding: isMobile ? '20px 12px' : '32px 16px' },
    navbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, gap: 8, flexWrap: 'wrap' },
    brand: { display: 'flex', alignItems: 'center', gap: 10, fontWeight: 800, letterSpacing: 0.4 },
    brandBadge: { width: 10, height: 10, borderRadius: 12, background: 'linear-gradient(45deg,#00e0ff,#7b61ff)' },
    btn: { padding: '10px 14px', borderRadius: 12, border: `1px solid ${colors.border}`, background: colors.button, color: colors.text, cursor: 'pointer' },
    btnPrimary: { background: colors.buttonPrimary, border: 'none', color: '#fff' },
    h1: { fontSize: isMobile ? 28 : 36, lineHeight: 1.2, color: colors.title, margin: '6px 0 8px' },
    h2: { fontSize: isMobile ? 18 : 22, margin: '16px 0 8px', color: colors.title },
    p: { margin: '6px 0', color: colors.hint },
    card: { background: colors.cardBg, border: `1px solid ${colors.border}`, borderRadius: 16, padding: 16, marginTop: 14 },
    list: { margin: '8px 0 8px 18px' },
    code: { fontFamily: 'monospace', padding: '2px 6px', borderRadius: 6, border: `1px solid ${colors.border}` },
    link: { color: dark ? '#61dafb' : '#0969da', textDecoration: 'none', fontWeight: 600 }
  };
  const ORDERBOOK = '0xc42e757Cafa9219716A6b504986005319d6813eA';
  const ROUTER = '0xd753D91AE23D79A4178368efef2981aee315ccaA';

  return (
    <div style={s.page}>
      <div style={s.container}>
        <div style={s.navbar}>
          <div style={s.brand}>
            <span style={s.brandBadge} />
            CookBook — Documentation
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button style={s.btn} onClick={() => setTheme(dark ? 'light' : 'dark')}>{dark ? 'Light Theme' : 'Dark Theme'}</button>
            <a href="#/" style={{ ...s.btn, textDecoration: 'none' }}>Home</a>
            <button style={{ ...s.btn, ...s.btnPrimary }} onClick={goTrade}>Launch App</button>
          </div>
        </div>

        <div style={s.card}>
          <h1 style={s.h1}>How CookBook Works</h1>
          <p style={s.p}>CookBook is a hybrid order book DEX on BNB Smart Chain (BSC). Users sign orders off-chain and settlement happens fully on-chain for transparency and security.</p>
        </div>

        <div style={s.card}>
          <h2 style={s.h2}>Quick Start</h2>
          <ol style={s.list}>
            <li><span style={s.p}>Connect your wallet on BSC Mainnet (Chain ID 56).</span></li>
            <li><span style={s.p}>Choose any ERC-20 token pair listed under Markets.</span></li>
            <li><span style={s.p}>Place an order by signing it (EIP-712). Your funds remain in your wallet until a match happens.</span></li>
            <li><span style={s.p}>Approve the Router for the token you will pay as taker:</span>
              <ul style={s.list}>
                <li><span style={s.p}>If the maker is SELL, the taker pays the quote token.</span></li>
                <li><span style={s.p}>If the maker is BUY, the taker pays the base token.</span></li>
              </ul>
            </li>
            <li><span style={s.p}>When prices cross, the relayer settles the trade on-chain via the Router.</span></li>
          </ol>
        </div>

        <div style={s.card}>
          <h2 style={s.h2}>Fees</h2>
          <p style={s.p}>CookBook charges a 0.4% fee in the quote token, only when a trade fills. The fee is paid by the side that pays quote tokens in the trade:</p>
          <ul style={s.list}>
            <li><span style={s.p}>Maker SELL (side=0): Taker pays quote + fee.</span></li>
            <li><span style={s.p}>Maker BUY (side=1): Maker pays quote + fee.</span></li>
          </ul>
        </div>

        <div style={s.card}>
          <h2 style={s.h2}>Approvals</h2>
          <p style={s.p}><strong>Taker</strong>: Approve the Router for the token you pay.</p>
          <p style={s.p}><strong>Maker</strong>: Approve the OrderBook for the token you transfer when filled (base for SELL, quote for BUY).</p>
          <p style={{ ...s.p, marginTop: 8 }}>
            Router: <code style={s.code}>{ROUTER}</code>
            {' '}·{' '}
            <a style={s.link} target="_blank" rel="noreferrer" href={`https://bscscan.com/address/${ROUTER}`}>View on BscScan</a>
          </p>
          <p style={s.p}>
            OrderBook: <code style={s.code}>{ORDERBOOK}</code>
            {' '}·{' '}
            <a style={s.link} target="_blank" rel="noreferrer" href={`https://bscscan.com/address/${ORDERBOOK}`}>View on BscScan</a>
          </p>
        </div>

        <div style={s.card}>
          <h2 style={s.h2}>Security & Transparency</h2>
          <ul style={s.list}>
            <li><span style={s.p}>Non-custodial: Funds remain in your wallet until fills occur.</span></li>
            <li><span style={s.p}>EIP-712 signatures: Orders are authenticated by the maker.</span></li>
            <li><span style={s.p}>On-chain settlement: All transfers execute via the OrderBook contract.</span></li>
            <li><span style={s.p}>Event-rich logs: Fills, cancellations, and allowlist changes are emitted on-chain.</span></li>
          </ul>
        </div>

        <div style={{ textAlign: 'center', marginTop: 20 }}>
          <button style={{ ...s.btn, ...s.btnPrimary }} onClick={goTrade}>Open CookBook</button>
        </div>
      </div>
    </div>
  );
}

// Persistent theme hook
function useLocalStorage(key, initial) {
  const [val, setVal] = React.useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : initial;
    } catch {
      return initial;
    }
  });
  React.useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
  }, [key, val]);
  return [val, setVal];
}

export default function App() {
  const [route, setRoute] = useState(() => window.location.hash || '#/');
  useEffect(() => {
    const onHash = () => setRoute(window.location.hash || '#/');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const [theme, setTheme] = useLocalStorage('ui:theme', 'dark');

  const goTrade = () => { try { window.location.hash = '#/trade'; } catch {} };

  if (route === '#/trade') return <CookBookUI />;
  if (route === '#/docs') return <Docs theme={theme} setTheme={setTheme} goTrade={goTrade} />;
  return <Landing goTrade={goTrade} theme={theme} setTheme={setTheme} />;
}
