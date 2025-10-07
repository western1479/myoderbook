import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import { createWeb3Modal, defaultConfig } from '@web3modal/ethers/react';

// WalletConnect Project ID (set in your .env as REACT_APP_WALLETCONNECT_ID)
const projectId = process.env.REACT_APP_WALLETCONNECT_ID || 'CHANGE_ME_PROJECT_ID';

// BSC mainnet chain config for Web3Modal
const bsc = {
  chainId: 56,
  name: 'BNB Smart Chain',
  currency: 'BNB',
  explorerUrl: 'https://bscscan.com',
  rpcUrl: 'https://bsc.publicnode.com'
};

const metadata = {
  name: 'OrderBook',
  description: 'Hybrid order book dApp',
  url: window.location.origin,
  icons: ['https://avatars.githubusercontent.com/u/37784886?s=200&v=4']
};

// Initialize Web3Modal theme from saved app theme (persisted by our UI)
const savedTheme = (() => {
  try {
    const raw = localStorage.getItem('ui:theme');
    return raw ? JSON.parse(raw) : 'dark';
  } catch {
    return 'dark';
  }
})();

createWeb3Modal({
  ethersConfig: defaultConfig({ metadata }),
  chains: [bsc],
  projectId,
  themeMode: savedTheme === 'light' ? 'light' : 'dark'
});

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

reportWebVitals();
