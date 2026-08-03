/**
 * Bridge ETH from Ethereum Sepolia → Gensyn Testnet (OP Stack canonical bridge).
 *
 * Prereq: Sepolia ETH in the registered wallet.
 *   Faucet: https://cloud.google.com/application/web3/faucet/ethereum/sepolia
 *
 * Usage: npm run fund:bridge -- 0.01
 */
import "dotenv/config";
import {
  createPublicClient,
  createWalletClient,
  formatEther,
  http,
  parseEther,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const DEFAULT_SEPOLIA_RPC = "https://ethereum-sepolia-rpc.publicnode.com";
const SEPOLIA_RPC = process.env.SEPOLIA_RPC_URL ?? DEFAULT_SEPOLIA_RPC;
const L1_STANDARD_BRIDGE = "0xaf99ffa3281548a1c30fcb443f066eaff2d297d4" as const;
const L2_MIN_GAS_LIMIT = 200_000;
const L1_MIN_TX_GAS = 500_000n;

const L1_BRIDGE_ABI = [
  {
    name: "depositETH",
    type: "function",
    inputs: [
      { name: "_minGasLimit", type: "uint32" },
      { name: "_extraData", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "payable",
  },
] as const;

const amountStr = process.argv[2];
if (!amountStr) {
  console.error("Usage: npm run fund:bridge -- <amount-eth>");
  console.error("Example: npm run fund:bridge -- 0.01");
  process.exit(1);
}

const pk = process.env.WALLET_PRIVATE_KEY?.trim() as Hex | undefined;
if (!pk) {
  console.error("Missing WALLET_PRIVATE_KEY in .env");
  process.exit(1);
}

const account = privateKeyToAccount(pk);
const amount = parseEther(amountStr);

const wallet = createWalletClient({
  account,
  chain: sepolia,
  transport: http(SEPOLIA_RPC),
});
const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(SEPOLIA_RPC),
});

const ethBalance = await publicClient.getBalance({ address: account.address });
console.log("Wallet:          " + account.address);
console.log("Sepolia RPC:     " + SEPOLIA_RPC);
console.log("Sepolia balance: " + formatEther(ethBalance) + " ETH");
console.log("Bridging:        " + amountStr + " ETH → Gensyn Testnet");
console.log("Bridge:          " + L1_STANDARD_BRIDGE);

if (ethBalance < amount) {
  console.error("\nInsufficient Sepolia ETH.");
  console.error(
    "Claim faucet ETH first: https://cloud.google.com/application/web3/faucet/ethereum/sepolia",
  );
  console.error("Address to fund: " + account.address);
  process.exit(1);
}

const depositArgs = {
  address: L1_STANDARD_BRIDGE,
  abi: L1_BRIDGE_ABI,
  functionName: "depositETH" as const,
  args: [L2_MIN_GAS_LIMIT, "0x"] as const,
  value: amount,
  account,
};

await publicClient.simulateContract(depositArgs);
const estimated = await publicClient.estimateContractGas(depositArgs);
const scaled = (estimated * 3n) / 2n;
const gas = scaled > L1_MIN_TX_GAS ? scaled : L1_MIN_TX_GAS;

console.log("\nSubmitting deposit...");
const hash = await wallet.writeContract({ ...depositArgs, gas });
console.log("Sepolia tx: " + hash);
console.log("Explorer:   https://sepolia.etherscan.io/tx/" + hash);

const receipt = await publicClient.waitForTransactionReceipt({ hash });
if (receipt.status === "reverted") {
  console.error("Bridge deposit reverted.");
  process.exit(1);
}

console.log("\nDeposit confirmed on Sepolia.");
console.log(
  "Gensyn ETH usually arrives in a few minutes (check Internal txns):",
);
console.log(
  "https://gensyn-testnet.explorer.alchemy.com/address/" + account.address,
);
console.log("\nThen claim mock USDC: npm run fund:faucet");
