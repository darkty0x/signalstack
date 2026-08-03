/**
 * Claim 1,000 mock USDC from the Gensyn testnet faucet.
 * Requires Gensyn testnet ETH for gas (bridge first).
 *
 * Usage: npm run fund:faucet
 */
import "dotenv/config";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatEther,
  http,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const GENSYN_RPC =
  process.env.GENSYN_RPC_URL ?? "https://gensyn-testnet.g.alchemy.com/public";
const FAUCET = "0xB5876320DdA1AEE3eFC03aD02dC2e2CB4b61B7D9" as const;
const USDC = "0x0724D6079b986F8e44bDafB8a09B60C0bd6A45a1" as const;

const gensyn = defineChain({
  id: 685685,
  name: "Gensyn Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [GENSYN_RPC] } },
  blockExplorers: {
    default: {
      name: "Alchemy",
      url: "https://gensyn-testnet.explorer.alchemy.com",
    },
  },
});

const FAUCET_ABI = [
  {
    name: "requestToken",
    type: "function",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

const ERC20_ABI = [
  {
    name: "balanceOf",
    type: "function",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
] as const;

const pk = process.env.WALLET_PRIVATE_KEY?.trim() as Hex | undefined;
if (!pk) {
  console.error("Missing WALLET_PRIVATE_KEY in .env");
  process.exit(1);
}

const account = privateKeyToAccount(pk);
const wallet = createWalletClient({
  account,
  chain: gensyn,
  transport: http(GENSYN_RPC),
});
const publicClient = createPublicClient({
  chain: gensyn,
  transport: http(GENSYN_RPC),
});

const eth = await publicClient.getBalance({ address: account.address });
const before = await publicClient.readContract({
  address: USDC,
  abi: ERC20_ABI,
  functionName: "balanceOf",
  args: [account.address],
});

console.log("Wallet:         " + account.address);
console.log("Gensyn ETH:     " + formatEther(eth));
console.log("USDC before:    " + (Number(before) / 1e6).toFixed(4));
console.log("Faucet:         " + FAUCET);

if (eth === 0n) {
  console.error("\nNo Gensyn ETH for gas.");
  console.error("1) Claim Sepolia ETH faucet");
  console.error("2) npm run fund:bridge -- 0.01");
  console.error("3) Wait a few minutes, then re-run this command");
  process.exit(1);
}

console.log("\nClaiming 1,000 USDC…");
const hash = await wallet.writeContract({
  address: FAUCET,
  abi: FAUCET_ABI,
  functionName: "requestToken",
});
console.log("Tx: " + hash);
console.log(
  "Explorer: https://gensyn-testnet.explorer.alchemy.com/tx/" + hash,
);

const receipt = await publicClient.waitForTransactionReceipt({ hash });
if (receipt.status === "reverted") {
  console.error("Faucet tx reverted.");
  process.exit(1);
}

const after = await publicClient.readContract({
  address: USDC,
  abi: ERC20_ABI,
  functionName: "balanceOf",
  args: [account.address],
});
console.log("USDC after:     " + (Number(after) / 1e6).toFixed(4));
console.log(
  "Received:       " + (Number(after - before) / 1e6).toFixed(4) + " USDC",
);
