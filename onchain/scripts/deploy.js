const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const OrderBook = await hre.ethers.getContractFactory("OrderBook");
  const orderBook = await OrderBook.deploy();
  await orderBook.waitForDeployment();

  const addr = await orderBook.getAddress();
  console.log("OrderBook deployed to:", addr);

  const feeBps = await orderBook.feeBps();
  const feeRecipient = await orderBook.feeRecipient();
  console.log("feeBps:", feeBps.toString());
  console.log("feeRecipient:", feeRecipient);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
