import assert from "node:assert/strict";
import { test } from "node:test";
import { runTicket } from "../src/agent.ts";
import { classifyWithRules } from "../src/classify.ts";
import { searchKb } from "../src/kb.ts";
import type { Ticket } from "../src/types.ts";

// All tests run in the deterministic rule-based mode (no API key).

function ticket(partial: Partial<Ticket>): Ticket {
  return { id: "test", customerId: "cust_001", subject: "", body: "", ...partial };
}

test("password reset is classified as account and auto-replied from the KB", async () => {
  const result = await runTicket(
    ticket({ subject: "Can't reset my password", body: "The reset link expired, how do I get back into my account?" }),
  );
  assert.equal(result.classification.category, "account");
  assert.equal(result.action, "auto_reply");
  assert.match(result.reply ?? "", /reset/i);
});

test("angry refund demand is escalated, never auto-replied", async () => {
  const result = await runTicket(
    ticket({
      customerId: "cust_002",
      subject: "Charged twice — refund NOW",
      body: "This is unacceptable, I am furious. Refund me now.",
    }),
  );
  assert.equal(result.action, "escalate");
  assert.match(result.escalationReason ?? "", /angry|de-escalation/i);
});

test("legal language is escalated before anything else", async () => {
  const result = await runTicket(
    ticket({ subject: "Data breach", body: "My lawyer will contact you about legal action over the breach." }),
  );
  assert.equal(result.classification.priority, "urgent");
  assert.equal(result.action, "escalate");
});

test("suspended account is escalated even when a KB article matches", async () => {
  const result = await runTicket(
    ticket({
      customerId: "cust_004",
      subject: "Locked out after changing my plan",
      body: "I am locked out and cannot access the workspace since the plan change.",
    }),
  );
  assert.equal(result.action, "escalate");
  assert.match(result.escalationReason ?? "", /suspended/i);
});

test("vague ticket with no signal is escalated for low confidence", async () => {
  const result = await runTicket(ticket({ subject: "Something is wrong", body: "It just doesn't work. Please fix it." }));
  assert.equal(result.action, "escalate");
  assert.match(result.escalationReason ?? "", /confidence/i);
});

test("refund request from a calm customer still goes to a human", async () => {
  const result = await runTicket(
    ticket({ subject: "Refund for last month", body: "Hello, I would like to request a refund for the last billing period, please." }),
  );
  assert.equal(result.action, "escalate");
  assert.match(result.escalationReason ?? "", /refund/i);
});

test("classifier separates categories", () => {
  assert.equal(classifyWithRules(ticket({ subject: "Where is my order?", body: "When will my package arrive?" })).category, "shipping");
  assert.equal(classifyWithRules(ticket({ subject: "Invoice copy", body: "I need the invoice for my billing statement." })).category, "billing");
  assert.equal(classifyWithRules(ticket({ subject: "Export crash", body: "The app crashes on export." })).category, "technical");
});

test("KB search ranks the right article first", () => {
  const matches = searchKb("app crashes when I export to PDF");
  assert.ok(matches.length > 0);
  assert.equal(matches[0].article.id, "export-crash");
  assert.ok(matches[0].score >= 2);
});
