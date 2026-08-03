import type { DelphiClient } from "@gensyn-ai/gensyn-delphi-sdk";
import { formatEther } from "viem";
import type { AgentConfig } from "./config.js";
import { usdcFromAtomic } from "./util/math.js";

export type Balances = {
  eth: string;
  ethWei: string;
  token: string;
  tokenAtomic: string;
  tokenDecimals: number;
  bankrollUsdc: number;
};

export async function readBalances(
  client: DelphiClient,
  _cfg: AgentConfig,
): Promise<Balances> {
  const eth = await client.getEthBalance();
  const { balance, decimals } = await client.getErc20BalanceWithDecimals();
  const human =
    decimals === 6
      ? usdcFromAtomic(balance)
      : Number(balance) / 10 ** decimals;

  return {
    eth: formatEther(eth),
    ethWei: eth.toString(),
    token: human.toFixed(4),
    tokenAtomic: balance.toString(),
    tokenDecimals: decimals,
    bankrollUsdc: Math.max(0, human),
  };
}
