require("dotenv").config();
require("@nomicfoundation/hardhat-toolbox");

module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
    },
  },
  networks: {
    bsc: {
      url: process.env.BSC_RPC_URL || "",
      chainId: 56,
      accounts: process.env.BSC_PRIVATE_KEY ? [process.env.BSC_PRIVATE_KEY] : [],
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  etherscan: {
    // Supports multi-chain Etherscan key and React-style env var as fallback
    apiKey: process.env.ETHERSCAN_API_KEY || process.env.REACT_APP_ETHERSCAN_API_KEY || "",
  },
};
