import { expect } from "chai";
import { ethers } from "hardhat";

describe("Sandbox mocks (Commit 1)", () => {
  describe("MockERC20", () => {
    async function deployToken(name: string, symbol: string, decimals: number) {
      const [deployer, user] = await ethers.getSigners();
      const token = await (await ethers.getContractFactory("MockERC20")).deploy(name, symbol, decimals);
      return { token, deployer, user };
    }

    it("honors configurable decimals (stable 6 / volatile 18)", async () => {
      const { token: usdc } = await deployToken("USD Coin", "USDC", 6);
      const { token: weth } = await deployToken("Wrapped Ether", "WETH", 18);
      expect(await usdc.decimals()).to.equal(6);
      expect(await weth.decimals()).to.equal(18);
      expect(await usdc.symbol()).to.equal("USDC");
      expect(await weth.name()).to.equal("Wrapped Ether");
    });

    it("mints to an address and tracks balance + supply", async () => {
      const { token, user } = await deployToken("USD Coin", "USDC", 6);
      const amount = 1_000_000n * 10n ** 6n; // 1,000,000 USDC
      await token.mint(user.address, amount);
      expect(await token.balanceOf(user.address)).to.equal(amount);
      expect(await token.totalSupply()).to.equal(amount);
    });

    it("transfers like a standard ERC20", async () => {
      const { token, deployer, user } = await deployToken("Wrapped Ether", "WETH", 18);
      const amount = ethers.parseEther("10");
      await token.mint(deployer.address, amount);
      await token.transfer(user.address, ethers.parseEther("4"));
      expect(await token.balanceOf(deployer.address)).to.equal(ethers.parseEther("6"));
      expect(await token.balanceOf(user.address)).to.equal(ethers.parseEther("4"));
    });
  });

  describe("MockV3Aggregator", () => {
    // ETH/USD style feed: 8 decimals, $2,000 initial.
    const DECIMALS = 8;
    const INITIAL = 2000n * 10n ** 8n;

    async function deployFeed() {
      const feed = await (await ethers.getContractFactory("MockV3Aggregator")).deploy(DECIMALS, INITIAL);
      return { feed };
    }

    it("reports decimals and an initial round on deploy", async () => {
      const { feed } = await deployFeed();
      expect(await feed.decimals()).to.equal(DECIMALS);
      const [roundId, answer] = await feed.latestRoundData();
      expect(roundId).to.equal(1n);
      expect(answer).to.equal(INITIAL);
    });

    it("advances the round and updates the answer", async () => {
      const { feed } = await deployFeed();
      const next = 2500n * 10n ** 8n;
      await feed.updateAnswer(next);

      const [roundId, answer, , updatedAt] = await feed.latestRoundData();
      expect(roundId).to.equal(2n);
      expect(answer).to.equal(next);
      expect(updatedAt).to.be.greaterThan(0n);
    });

    it("serves historical rounds via getRoundData", async () => {
      const { feed } = await deployFeed();
      await feed.updateAnswer(3000n * 10n ** 8n); // round 2

      const [, firstAnswer] = await feed.getRoundData(1);
      const [, secondAnswer] = await feed.getRoundData(2);
      expect(firstAnswer).to.equal(INITIAL);
      expect(secondAnswer).to.equal(3000n * 10n ** 8n);
    });
  });
});
