import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Commit 5 — deploy the real ChainlinkFunctionsVerifier and switch AgentPassport
 * onto the DON-powered verification path. Run AFTER `deploy:baseSepolia` (which
 * deploys the core + MockOutcomeVerifier fallback) and AFTER you have created a
 * Functions subscription (you need its id for the constructor).
 *
 *   npm --workspace contracts run deploy:chainlink
 *
 * Required env (contracts/.env):
 *   DEPLOYER_PRIVATE_KEY          (owner of the AgentPassport deployed on Base Sepolia)
 *   PASSPORT_ADDRESS              (AgentPassport on Base Sepolia, from deploy:baseSepolia)
 *   FUNCTIONS_ROUTER              (Base Sepolia Functions router)
 *   FUNCTIONS_DON_ID              (e.g. "fun-base-sepolia-1")
 *   FUNCTIONS_SUBSCRIPTION_ID     (created at functions.chain.link)
 *   FUNCTIONS_CALLBACK_GAS_LIMIT  (<= router max, default 300000)
 *
 * After this runs: add the printed verifier address as a CONSUMER on your
 * subscription, fund it with LINK, then run the smoke test.
 */
function need(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env ${key}`);
  return v;
}

async function main() {
  if (network.name !== "baseSepolia") {
    console.warn(`! network is "${network.name}" — expected baseSepolia for a real DON deployment.`);
  }

  const [deployer] = await ethers.getSigners();
  const passportAddr = need("PASSPORT_ADDRESS");
  const router = need("FUNCTIONS_ROUTER");
  const donId = ethers.encodeBytes32String(need("FUNCTIONS_DON_ID"));
  const subscriptionId = BigInt(need("FUNCTIONS_SUBSCRIPTION_ID"));
  const callbackGasLimit = Number(process.env.FUNCTIONS_CALLBACK_GAS_LIMIT ?? "300000");

  console.log(`Network : ${network.name}`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Passport: ${passportAddr}`);
  console.log(`Router  : ${router}`);
  console.log(`DON id  : ${process.env.FUNCTIONS_DON_ID} (${donId})`);
  console.log(`Sub id  : ${subscriptionId}`);
  console.log(`Gas lim : ${callbackGasLimit}`);

  // 1) Deploy the verifier (consumer = AgentPassport).
  const Verifier = await ethers.getContractFactory("ChainlinkFunctionsVerifier");
  const verifier = await Verifier.deploy(router, passportAddr, donId, subscriptionId, deployer.address);
  await verifier.waitForDeployment();
  const verifierAddr = await verifier.getAddress();
  console.log(`\nChainlinkFunctionsVerifier: ${verifierAddr}`);

  // 2) Load & set the audited DON source.
  const source = fs.readFileSync(path.join(__dirname, "..", "chainlink", "source.js"), "utf8");
  await (await verifier.setSource(source)).wait();
  console.log("source.js set on verifier.");

  // 3) Reaffirm config (sets callback gas limit explicitly).
  await (await verifier.setConfig(subscriptionId, callbackGasLimit, donId)).wait();
  console.log("Config set (sub, callbackGasLimit, donId).");

  // 4) Point AgentPassport at the live verifier (requires deployer == owner).
  const passport = await ethers.getContractAt("AgentPassport", passportAddr);
  await (await passport.setVerifier(verifierAddr)).wait();
  console.log("AgentPassport.verifier -> ChainlinkFunctionsVerifier.");

  console.log("\nNEXT (dashboard, human steps):");
  console.log(`  1. Add consumer ${verifierAddr} to subscription ${subscriptionId}`);
  console.log("  2. Fund the subscription with LINK");
  console.log("  3. Run: npm --workspace contracts run smoke:chainlink");
  console.log("\nTo roll back to the mock fallback: passport.setVerifier(<MockOutcomeVerifier>)");

  console.log(
    "\n" +
      JSON.stringify(
        { network: network.name, ChainlinkFunctionsVerifier: verifierAddr, passport: passportAddr, subscriptionId: subscriptionId.toString() },
        null,
        2
      )
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
