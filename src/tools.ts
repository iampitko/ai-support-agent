import { searchKb, type KbMatch } from "./kb.ts";

/**
 * The agent's tool set. Each tool is a plain function with a narrow contract;
 * the agent calls them explicitly and logs every call (see agent.ts).
 *
 * In a production deployment these would call a real help-center API, the
 * billing/account service, and the ticketing system's escalation endpoint.
 */

export interface ToolSet {
  search_kb: (query: string) => KbMatch[];
  get_account_status: (customerId: string) => AccountStatus;
  escalate: (ticketId: string, reason: string) => { escalationId: string };
}

export interface AccountStatus {
  customerId: string;
  plan: "free" | "pro" | "enterprise" | "unknown";
  status: "active" | "past_due" | "suspended" | "unknown";
  openTickets: number;
}

/** Mock account service standing in for a real CRM/billing lookup. */
const ACCOUNTS: Record<string, AccountStatus> = {
  cust_001: { customerId: "cust_001", plan: "pro", status: "active", openTickets: 0 },
  cust_002: { customerId: "cust_002", plan: "pro", status: "past_due", openTickets: 2 },
  cust_003: { customerId: "cust_003", plan: "free", status: "active", openTickets: 1 },
  cust_004: { customerId: "cust_004", plan: "enterprise", status: "suspended", openTickets: 3 },
};

let escalationCounter = 0;

export const tools: ToolSet = {
  search_kb(query: string): KbMatch[] {
    return searchKb(query, 3);
  },

  get_account_status(customerId: string): AccountStatus {
    return (
      ACCOUNTS[customerId] ?? {
        customerId,
        plan: "unknown",
        status: "unknown",
        openTickets: 0,
      }
    );
  },

  escalate(ticketId: string, reason: string): { escalationId: string } {
    escalationCounter += 1;
    void reason;
    return { escalationId: `esc_${ticketId}_${escalationCounter}` };
  },
};
