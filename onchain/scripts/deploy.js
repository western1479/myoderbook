const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const CookBook = await hre.ethers.getContractFactory("CookBook");
  const CookBook = await CookBook.deploy();
  await CookBook.waitForDeployment();

  const obAddr = await CookBook.getAddress();
  console.log("CookBook deployed to:", obAddr);

  const Router = await hre.ethers.getContractFactory("SettlementRouter");
  const router = await Router.deploy(obAddr);
  await router.waitForDeployment();
  const routerAddr = await router.getAddress();
  console.log("SettlementRouter deployed to:", routerAddr);

  const feeBps = await CookBook.feeBps();
  const feeRecipient = await CookBook.feeRecipient();
  console.log("feeBps:", feeBps.toString());
  console.log("feeRecipient:", feeRecipient);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
