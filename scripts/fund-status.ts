/**
 * Show Sepolia + Gensyn balances for the registered wallet.
 * Usage: npm run fund:status
 */
import "dotenv/config";
import {
  createPublicClient,
  defineChain,
  formatEther,
  http,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const SEPOLIA_RPC =
  process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
const GENSYN_RPC =
  process.env.GENSYN_RPC_URL ?? "https://gensyn-testnet.g.alchemy.com/public";
const USDC = "0x0724D6079b986F8e44bDafB8a09B60C0bd6A45a1" as const;

const gensyn = defineChain({
  id: 685685,
  name: "Gensyn Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [GENSYN_RPC] } },
});

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
const configured =
  process.env.SIGNALSTACK_WALLET?.trim() ||
  "0x67df2320690a7870c20105662d525a567254b7d5";

const address = pk
  ? privateKeyToAccount(pk).address
  : (configured as `0x${string}`);

const sepoliaClient = createPublicClient({
  chain: sepolia,
  transport: http(SEPOLIA_RPC),
});
const gensynClient = createPublicClient({
  chain: gensyn,
  transport: http(GENSYN_RPC),
});

const [sepoliaEth, gensynEth, usdc] = await Promise.all([
  sepoliaClient.getBalance({ address }),
  gensynClient.getBalance({ address }),
  gensynClient.readContract({
    address: USDC,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [address],
  }),
]);

console.log("Wallet:       " + address);
if (pk) {
  const match = address.toLowerCase() === configured.toLowerCase();
  console.log("Matches reg:  " + (match ? "yes" : "NO — check SIGNALSTACK_WALLET"));
}
console.log("Sepolia ETH:  " + formatEther(sepoliaEth));
console.log("Gensyn ETH:   " + formatEther(gensynEth));
console.log("Gensyn USDC:  " + (Number(usdc) / 1e6).toFixed(4));
console.log("");
if (sepoliaEth === 0n) {
  console.log("Next: claim Sepolia ETH");
  console.log(
    "  https://cloud.google.com/application/web3/faucet/ethereum/sepolia",
  );
  console.log("  Address: " + address);
} else if (gensynEth === 0n) {
  console.log("Next: npm run fund:bridge -- 0.01");
} else if (usdc === 0n) {
  console.log("Next: npm run fund:faucet");
} else {
  console.log("Funded. Desk: https://signalstack.up.railway.app");
}
