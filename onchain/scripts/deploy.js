const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const COOKBOOK = await hre.ethers.getContractFactory("COOKBOOK");
  const COOKBOOK = await COOKBOOK.deploy();
  await COOKBOOK.waitForDeployment();

  const obAddr = await COOKBOOK.getAddress();
  console.log("COOKBOOK deployed to:", obAddr);

  const Router = await hre.ethers.getContractFactory("SettlementRouter");
  const router = await Router.deploy(obAddr);
  await router.waitForDeployment();
  const routerAddr = await router.getAddress();
  console.log("SettlementRouter deployed to:", routerAddr);

  const feeBps = await COOKBOOK.feeBps();
  const feeRecipient = await COOKBOOK.feeRecipient();
  console.log("feeBps:", feeBps.toString());
  console.log("feeRecipient:", feeRecipient);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
