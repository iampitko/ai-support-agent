import type { Category, Classification, Priority, Sentiment, Ticket } from "./types.ts";

/**
 * Classification has two engines:
 *
 * 1. `classifyWithClaude` — used when ANTHROPIC_API_KEY is set. One Messages
 *    API call with a forced tool call, so the model returns structured data
 *    instead of free text.
 * 2. `classifyWithRules` — a deterministic keyword fallback. It is the only
 *    engine used in tests and in the no-key demo, and it is also the safety
 *    net if the API call fails.
 *
 * The routing policy in agent.ts is deliberately NOT part of the classifier:
 * the model (or rules) describes the ticket, plain code decides what to do.
 */

const CATEGORY_KEYWORDS: Record<Exclude<Category, "general">, string[]> = {
  billing: ["charge", "charged", "refund", "invoice", "billing", "payment", "card", "price", "cost"],
  technical: ["crash", "error", "bug", "broken", "freeze", "not working", "slow", "export", "app"],
  account: ["password", "login", "log in", "locked", "access", "sign in", "account", "reset", "2fa"],
  shipping: ["order", "delivery", "shipped", "tracking", "package", "arrive"],
};

const ANGRY_WORDS = ["furious", "unacceptable", "scam", "terrible", "worst", "outrageous", "disgrace"];
const NEGATIVE_WORDS = ["frustrated", "annoying", "disappointed", "problem", "issue", "wrong", "doesn't work", "not working"];
const POSITIVE_WORDS = ["thanks", "thank you", "love", "great", "awesome"];
/** Product/feature vocabulary: a "general" ticket full of these is a known-topic question, not an unknown one. */
const FEATURE_WORDS = ["sso", "saml", "plan", "pricing", "upgrade", "features", "enterprise", "do you offer"];
const URGENT_WORDS = ["breach", "leaked", "lawyer", "legal action", "outage", "security incident", "data loss"];
const HIGH_WORDS = ["locked out", "charged twice", "double charged", "cannot access", "can't access", "asap", "urgent", "refund"];

function countHits(text: string, words: string[]): number {
  return words.reduce((n, w) => (text.includes(w) ? n + 1 : n), 0);
}

export function classifyWithRules(ticket: Ticket): Classification {
  const text = `${ticket.subject} ${ticket.body}`.toLowerCase().replace(/[’]/g, "'");

  const scores = (Object.keys(CATEGORY_KEYWORDS) as (keyof typeof CATEGORY_KEYWORDS)[]).map(
    (cat) => ({ cat, hits: countHits(text, CATEGORY_KEYWORDS[cat]) }),
  );
  scores.sort((a, b) => b.hits - a.hits);
  const [top, second] = [scores[0], scores[1]];

  const category: Category = top.hits > 0 ? top.cat : "general";
  let confidence =
    top.hits === 0 ? 0.3 : Math.min(0.95, 0.55 + 0.12 * top.hits + 0.08 * (top.hits - (second?.hits ?? 0)));
  if (category === "general" && countHits(text, FEATURE_WORDS) >= 2) {
    // A feature/pricing question in known vocabulary is safe to route to the
    // KB check; if no article matches there, the agent still escalates.
    confidence = 0.75;
  }

  let priority: Priority = "low";
  if (countHits(text, URGENT_WORDS) > 0) priority = "urgent";
  else if (countHits(text, HIGH_WORDS) > 0) priority = "high";
  else if (category === "technical" || countHits(text, NEGATIVE_WORDS) > 0) priority = "medium";

  let sentiment: Sentiment = "neutral";
  if (countHits(text, ANGRY_WORDS) > 0 || /!{2,}/.test(ticket.body)) sentiment = "angry";
  else if (countHits(text, NEGATIVE_WORDS) > 0) sentiment = "negative";
  else if (countHits(text, POSITIVE_WORDS) > 0) sentiment = "positive";

  return {
    category,
    priority,
    sentiment,
    confidence,
    summary: ticket.subject.trim(),
    source: "rules",
  };
}

const CLASSIFY_TOOL = {
  name: "classify_ticket",
  description: "Record the classification of a customer support ticket.",
  input_schema: {
    type: "object",
    properties: {
      category: { type: "string", enum: ["billing", "technical", "account", "shipping", "general"] },
      priority: { type: "string", enum: ["low", "medium", "high", "urgent"] },
      sentiment: { type: "string", enum: ["positive", "neutral", "negative", "angry"] },
      confidence: { type: "number", description: "0 to 1" },
      summary: { type: "string", description: "One-line summary of the customer's issue." },
    },
    required: ["category", "priority", "sentiment", "confidence", "summary"],
  },
} as const;

export async function classifyWithClaude(ticket: Ticket, apiKey: string): Promise<Classification> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 512,
      tools: [CLASSIFY_TOOL],
      tool_choice: { type: "tool", name: "classify_ticket" },
      messages: [
        {
          role: "user",
          content: `Classify this support ticket.\n\nSubject: ${ticket.subject}\n\n${ticket.body}`,
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API returned ${res.status}`);
  const data = (await res.json()) as {
    content: { type: string; name?: string; input?: Record<string, unknown> }[];
  };
  const toolUse = data.content.find((b) => b.type === "tool_use" && b.name === "classify_ticket");
  if (!toolUse?.input) throw new Error("Model did not return a classification");
  const input = toolUse.input;
  return {
    category: input.category as Category,
    priority: input.priority as Priority,
    sentiment: input.sentiment as Sentiment,
    confidence: Number(input.confidence),
    summary: String(input.summary),
    source: "claude",
  };
}

/** Draft an auto-reply grounded in one KB article. Claude mode only. */
export async function draftReplyWithClaude(
  ticket: Ticket,
  articleBody: string,
  apiKey: string,
): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 400,
      system:
        "You draft customer support replies. Use ONLY facts from the knowledge base article provided. " +
        "Do not promise refunds, timelines or features that are not in the article. Keep it under 120 words, " +
        "friendly and direct. Sign off as 'Support Team'.",
      messages: [
        {
          role: "user",
          content:
            `Ticket subject: ${ticket.subject}\nTicket body: ${ticket.body}\n\n` +
            `Knowledge base article:\n${articleBody}\n\nDraft the reply.`,
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API returned ${res.status}`);
  const data = (await res.json()) as { content: { type: string; text?: string }[] };
  const text = data.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error("Model did not return a draft");
  return text.trim();
}
