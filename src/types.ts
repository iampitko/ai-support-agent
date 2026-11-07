export interface Ticket {
  id: string;
  customerId: string;
  subject: string;
  body: string;
}

export type Category = "billing" | "technical" | "account" | "shipping" | "general";
export type Priority = "low" | "medium" | "high" | "urgent";
export type Sentiment = "positive" | "neutral" | "negative" | "angry";

export interface Classification {
  category: Category;
  priority: Priority;
  sentiment: Sentiment;
  /** 0..1 — how sure the classifier is about the category. */
  confidence: number;
  summary: string;
  /** Which engine produced this: the LLM or the deterministic fallback. */
  source: "claude" | "rules";
}

export interface StepEntry {
  step: number;
  kind: "classify" | "tool" | "decision" | "reply";
  name: string;
  detail: string;
}

export interface AgentResult {
  ticketId: string;
  classification: Classification;
  action: "auto_reply" | "escalate";
  reply?: string;
  escalationReason?: string;
  steps: StepEntry[];
}
