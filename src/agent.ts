import { classifyWithClaude, classifyWithRules, draftReplyWithClaude } from "./classify.ts";
import { tools } from "./tools.ts";
import type { AgentResult, Classification, StepEntry, Ticket } from "./types.ts";

/**
 * Support triage agent.
 *
 * Flow: classify -> apply routing policy -> call tools -> act.
 * The policy is plain deterministic code (same in both modes) so behaviour
 * is auditable: the LLM classifies and drafts, it never decides routing.
 *
 * Escalation policy (first match wins):
 *   1. Legal / security language, or urgent priority
 *   2. Angry sentiment
 *   3. Refund request (financial action — a human owns it)
 *   4. Suspended account
 *   5. Billing issue on a past-due account
 *   6. Low classifier confidence (< 0.5)
 *   7. No knowledge-base article matches
 * Otherwise: auto-reply grounded in the best-matching KB article.
 */

export interface AgentOptions {
  apiKey?: string;
}

const LEGAL_WORDS = ["lawyer", "legal action", "breach", "gdpr", "lawsuit", "regulator"];

export async function runTicket(ticket: Ticket, options: AgentOptions = {}): Promise<AgentResult> {
  const steps: StepEntry[] = [];
  const log = (kind: StepEntry["kind"], name: string, detail: string) =>
    steps.push({ step: steps.length + 1, kind, name, detail });

  // 1. Classify (Claude if a key is configured, rules otherwise / on failure).
  let classification: Classification;
  if (options.apiKey) {
    try {
      classification = await classifyWithClaude(ticket, options.apiKey);
    } catch (err) {
      log("classify", "claude_fallback", `Claude classification failed (${(err as Error).message}); using rules`);
      classification = classifyWithRules(ticket);
    }
  } else {
    classification = classifyWithRules(ticket);
  }
  log(
    "classify",
    classification.source,
    `category=${classification.category} priority=${classification.priority} ` +
      `sentiment=${classification.sentiment} confidence=${classification.confidence.toFixed(2)}`,
  );

  const escalate = (reason: string): AgentResult => {
    const { escalationId } = tools.escalate(ticket.id, reason);
    log("tool", "escalate", `reason="${reason}" -> ${escalationId}`);
    log("decision", "escalate", reason);
    return { ticketId: ticket.id, classification, action: "escalate", escalationReason: reason, steps };
  };

  // 2. Routing policy.
  const text = `${ticket.subject} ${ticket.body}`.toLowerCase();
  if (LEGAL_WORDS.some((w) => text.includes(w)) || classification.priority === "urgent") {
    return escalate("Legal/security language or urgent priority — a human must handle this first");
  }
  if (classification.sentiment === "angry") {
    return escalate("Angry customer — de-escalation by a human, not a bot");
  }
  if (text.includes("refund")) {
    return escalate("Refund request — financial actions are handled by a human");
  }

  const account = tools.get_account_status(ticket.customerId);
  log(
    "tool",
    "get_account_status",
    `customer=${account.customerId} plan=${account.plan} status=${account.status} openTickets=${account.openTickets}`,
  );
  if (account.status === "suspended") {
    return escalate("Account is suspended — access restoration needs a human");
  }
  if (account.status === "past_due" && classification.category === "billing") {
    return escalate("Billing issue on a past-due account — billing team should handle it");
  }

  if (classification.confidence < 0.5) {
    return escalate(`Low classification confidence (${classification.confidence.toFixed(2)}) — not safe to automate`);
  }

  // 3. Find a KB article to answer from.
  const matches = tools.search_kb(`${ticket.subject} ${classification.summary} ${ticket.body}`);
  log(
    "tool",
    "search_kb",
    matches.length
      ? matches.map((m) => `${m.article.id} (score ${m.score})`).join(", ")
      : "no matches",
  );
  const best = matches[0];
  if (!best || best.score < 2) {
    return escalate("No knowledge-base article matches this ticket");
  }

  // 4. Draft the reply from the article (never free-form facts).
  let reply: string;
  if (options.apiKey) {
    try {
      reply = await draftReplyWithClaude(ticket, best.article.body, options.apiKey);
    } catch {
      reply = templateReply(best.article.title, best.article.body);
    }
  } else {
    reply = templateReply(best.article.title, best.article.body);
  }
  log("reply", "auto_reply", `grounded in KB article "${best.article.id}"`);
  log("decision", "auto_reply", `answered from KB article "${best.article.id}"`);
  return { ticketId: ticket.id, classification, action: "auto_reply", reply, steps };
}

function templateReply(articleTitle: string, articleBody: string): string {
  return (
    `Hi there,\n\nThanks for contacting us. ${articleBody}\n\n` +
    `If that doesn't solve it, just reply to this message and a member of our team will pick it up.\n\n` +
    `— Support Team (automated reply, based on "${articleTitle}")`
  );
}
