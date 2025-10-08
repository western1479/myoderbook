const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const OrderBook = await hre.ethers.getContractFactory("OrderBook");
  const orderBook = await OrderBook.deploy();
  await orderBook.waitForDeployment();

  const obAddr = await orderBook.getAddress();
  console.log("OrderBook deployed to:", obAddr);

  const Router = await hre.ethers.getContractFactory("SettlementRouter");
  const router = await Router.deploy(obAddr);
  await router.waitForDeployment();
  const routerAddr = await router.getAddress();
  console.log("SettlementRouter deployed to:", routerAddr);

  const feeBps = await orderBook.feeBps();
  const feeRecipient = await orderBook.feeRecipient();
  console.log("feeBps:", feeBps.toString());
  console.log("feeRecipient:", feeRecipient);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
