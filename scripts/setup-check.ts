#!/usr/bin/env node
import { readinessSummary } from "../src/readiness.js";

const { ready, checks } = readinessSummary();
for (const c of checks) {
  const mark = c.ok ? "OK " : "MISS";
  console.log(`[${mark}] ${c.label}: ${c.detail}`);
}
console.log("");
if (ready) {
  console.log("Ready. Start desk: npm run desk");
  process.exit(0);
}
console.log("Not ready. Create .env from .env.example and fill required keys.");
console.log("API key: https://delphi-api-access.gensyn.ai/");
process.exit(1);
