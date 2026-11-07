import { readFileSync } from "node:fs";
import { runTicket } from "./agent.ts";
import type { Ticket } from "./types.ts";

/**
 * Demo entry point: runs the triage agent over the sample tickets in
 * fixtures/tickets.json and prints the full step log for each one.
 *
 *   node src/index.ts           # rule-based fallback (no key needed)
 *   ANTHROPIC_API_KEY=... node src/index.ts   # Claude classification + drafting
 */

const tickets = JSON.parse(
  readFileSync(new URL("../fixtures/tickets.json", import.meta.url), "utf8"),
) as Ticket[];

const apiKey = process.env.ANTHROPIC_API_KEY;
console.log(`Mode: ${apiKey ? "Claude (ANTHROPIC_API_KEY set)" : "rule-based fallback (no API key)"}\n`);

let auto = 0;
let escalated = 0;

for (const ticket of tickets) {
  const result = await runTicket(ticket, { apiKey });
  console.log(`=== ${ticket.id}: "${ticket.subject}" (customer ${ticket.customerId})`);
  for (const s of result.steps) {
    console.log(`  ${s.step}. [${s.kind}] ${s.name}: ${s.detail}`);
  }
  if (result.action === "auto_reply") {
    auto += 1;
    console.log(`  ACTION: AUTO-REPLY\n${indent(result.reply ?? "")}`);
  } else {
    escalated += 1;
    console.log(`  ACTION: ESCALATE — ${result.escalationReason}`);
  }
  console.log();
}

console.log(`Summary: ${tickets.length} tickets — ${auto} auto-replied, ${escalated} escalated.`);

function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
}
