# AI Support Triage Agent

A reference implementation of a customer-support triage agent. It reads a
support ticket, classifies it (category, priority, sentiment), and then either
answers it from a small knowledge base or escalates it to a human with a
reason — logging every step it takes.

Built as a compact, dependency-free TypeScript/Node project to demonstrate an
applied-AI pattern: **the LLM classifies and drafts; plain, auditable code
decides what the agent is allowed to do.**

## How it runs

```bash
node src/index.ts        # or: npm start
npm test                 # node:test suite for the routing rules
```

Requires Node ≥ 22 (the code is TypeScript run directly via Node's built-in
type stripping — no build step, no dependencies).

Two modes:

| Mode | When | Classification | Reply drafting |
| --- | --- | --- | --- |
| Claude | `ANTHROPIC_API_KEY` is set | Claude via a forced tool call (structured output) | Claude, grounded in the KB article |
| Fallback | no key | Deterministic keyword rules | Template built from the KB article |

The fallback mode is fully functional, so the demo works out of the box.
If a Claude call fails at runtime, the agent falls back to the rules engine
and notes it in the step log.

## Architecture

```
ticket ──► classify ──► routing policy ──► tools ──► auto-reply / escalate
              │              │               │
         Claude or      deterministic    search_kb
         rules          checks, in       get_account_status (mock)
                        fixed order      escalate
```

- `src/classify.ts` — the two classification engines. The Claude engine makes
  one Messages API call with `tool_choice` forcing a `classify_ticket` tool
  call, so the model returns structured data instead of prose.
- `src/agent.ts` — the agent loop and the routing policy. Every tool call and
  decision is appended to a per-ticket **step log** (see sample output below).
- `src/tools.ts` — the tool set: `search_kb` (keyword search over the KB),
  `get_account_status` (a mock account service standing in for a CRM/billing
  lookup), `escalate`.
- `src/kb.ts` — six help-center articles with keyword metadata.
- `fixtures/tickets.json` — eight sample tickets exercising both paths.

## Safety / escalation design

The routing policy is ordinary code, identical in both modes — the LLM never
decides routing. First match wins:

1. Legal/security language, or urgent priority → escalate
2. Angry sentiment → escalate (humans de-escalate, bots don't)
3. Refund request → escalate (financial actions stay with humans)
4. Suspended account → escalate
5. Billing issue on a past-due account → escalate
6. Classifier confidence < 0.5 → escalate
7. No KB article matches → escalate

Otherwise the agent auto-replies, and the reply may only use facts from the
matched KB article: in Claude mode the drafting prompt restricts the model to
the article; in fallback mode the reply is assembled from the article text.
Automated replies are labelled as automated.

## Sample output

Real output from `node src/index.ts` in fallback mode (trimmed):

```
Mode: rule-based fallback (no API key)

=== t1: "Can't reset my password" (customer cust_001)
  1. [classify] rules: category=account priority=low sentiment=neutral confidence=0.95
  2. [tool] get_account_status: customer=cust_001 plan=pro status=active openTickets=0
  3. [tool] search_kb: password-reset (score 4)
  4. [reply] auto_reply: grounded in KB article "password-reset"
  5. [decision] auto_reply: answered from KB article "password-reset"
  ACTION: AUTO-REPLY
    Hi there,

    Thanks for contacting us. You can reset your password from the sign-in page: choose
    “Forgot password”, enter your account email, and follow the link we send you. Reset
    links expire after 30 minutes; if yours expired, request a fresh one and check your
    spam folder. If you use SSO, sign in through your identity provider instead.
    ...

=== t2: "Charged twice — I want a refund NOW" (customer cust_002)
  1. [classify] rules: category=billing priority=high sentiment=angry confidence=0.95
  2. [tool] escalate: reason="Angry customer — de-escalation by a human, not a bot" -> esc_t2_1
  3. [decision] escalate: Angry customer — de-escalation by a human, not a bot
  ACTION: ESCALATE — Angry customer — de-escalation by a human, not a bot

=== t5: "Locked out after changing my plan" (customer cust_004)
  1. [classify] rules: category=account priority=high sentiment=neutral confidence=0.95
  2. [tool] get_account_status: customer=cust_004 plan=enterprise status=suspended openTickets=3
  3. [tool] escalate: reason="Account is suspended — access restoration needs a human" -> esc_t5_2
  4. [decision] escalate: Account is suspended — access restoration needs a human
  ACTION: ESCALATE — Account is suspended — access restoration needs a human

Summary: 8 tickets — 4 auto-replied, 4 escalated.
```

The eight fixtures resolve to: 4 auto-replies (password reset, export crash,
order tracking, SSO plan question) and 4 escalations (angry refund demand,
suspended account, legal/data-breach language, and one too-vague-to-classify
ticket).

## Tests

`npm test` runs 8 tests (`node:test`) covering the routing rules in fallback
mode: auto-reply grounding, angry/refund/legal/suspended/low-confidence
escalations, category separation, and KB ranking. All 8 pass.

## Limitations

- The knowledge base is six in-code articles with keyword search — a real
  deployment would use a help-center API or a vector index, and would retrieve
  account/order data from real services instead of the mock in `tools.ts`.
- The fallback classifier is keyword-based; it will misread sarcasm, negation
  and multi-issue tickets. That is exactly what the confidence gate and the
  no-KB-match escalation are for, but it is a demo-grade classifier.
- Escalation is a stub that returns an ID; nothing is actually queued, sent or
  persisted, and auto-replies are printed, not emailed.
- The Claude path is implemented against the Anthropic Messages API but is
  only exercised when a key is provided; the shipped demo and tests run the
  fallback path.
