import { mkdirSync, appendFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const logDir = resolve(root, "data/logs");
const journalDir = resolve(root, "data/journal");

mkdirSync(logDir, { recursive: true });
mkdirSync(journalDir, { recursive: true });

function stamp(): string {
  return new Date().toISOString();
}

export function log(
  level: "info" | "warn" | "error",
  msg: string,
  extra?: unknown,
) {
  const line =
    extra === undefined
      ? `[${stamp()}] ${level.toUpperCase()} ${msg}`
      : `[${stamp()}] ${level.toUpperCase()} ${msg} ${JSON.stringify(extra)}`;
  console.log(line);
  appendFileSync(resolve(logDir, "agent.jsonl"), `${line}\n`);
}

export function journal(event: string, payload: Record<string, unknown>) {
  const row = { ts: stamp(), event, ...payload };
  appendFileSync(
    resolve(journalDir, "trades.jsonl"),
    `${JSON.stringify(row)}\n`,
  );
}
