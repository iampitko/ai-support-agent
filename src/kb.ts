export interface KbArticle {
  id: string;
  title: string;
  keywords: string[];
  /** Body of the help article; also used as the basis for auto-replies. */
  body: string;
}

export const KB: KbArticle[] = [
  {
    id: "password-reset",
    title: "Resetting your password",
    keywords: ["password", "reset", "forgot", "expired link", "reset link", "cant log in", "can't log in"],
    body:
      "You can reset your password from the sign-in page: choose “Forgot password”, " +
      "enter your account email, and follow the link we send you. Reset links expire after 30 minutes; " +
      "if yours expired, request a fresh one and check your spam folder. If you use SSO, sign in through " +
      "your identity provider instead.",
  },
  {
    id: "invoices-and-receipts",
    title: "Invoices and receipts",
    keywords: ["invoice", "receipt", "billing statement", "vat", "tax document", "download invoice"],
    body:
      "Invoices and receipts for every billing period are available under Settings → Billing → History. " +
      "You can download them as PDF and add your company name, address and VAT ID under Settings → Billing → " +
      "Details so they appear on future invoices.",
  },
  {
    id: "export-crash",
    title: "App crashes or freezes during export",
    keywords: ["export", "crash", "crashes", "pdf", "freeze", "freezes", "crashing"],
    body:
      "If the app crashes while exporting to PDF: (1) update to the latest version, (2) export in smaller " +
      "batches (under 200 pages at a time), and (3) disable “include original images” under Export settings. " +
      "If it still crashes, exporting from the web app instead of the desktop app avoids the issue while we " +
      "investigate.",
  },
  {
    id: "order-tracking",
    title: "Tracking your order",
    keywords: ["order", "tracking", "delivery", "shipped", "package", "arrive", "where is my order"],
    body:
      "You can track your order from the confirmation email or under Account → Orders. Tracking updates " +
      "appear within 24 hours of shipping. Standard delivery takes 3–5 business days; if tracking has not " +
      "moved for more than 5 business days, reply to this message and we will look into it.",
  },
  {
    id: "plans-and-features",
    title: "Plans, pricing and feature availability",
    keywords: ["plan", "pro", "sso", "saml", "pricing", "upgrade", "features", "enterprise"],
    body:
      "SSO/SAML, audit logs and advanced permissions are available on the Pro and Enterprise plans. " +
      "You can compare plans and upgrade under Settings → Billing → Plans; upgrades apply immediately and " +
      "are prorated for the rest of the billing period.",
  },
  {
    id: "two-factor-auth",
    title: "Setting up two-factor authentication (2FA)",
    keywords: ["2fa", "two-factor", "two factor", "authenticator", "verification code", "security key"],
    body:
      "Enable two-factor authentication under Settings → Security → Two-factor authentication. Scan the QR " +
      "code with any authenticator app and store the recovery codes somewhere safe. If you lose access to " +
      "your authenticator, a recovery code is the fastest way back in.",
  },
];

export interface KbMatch {
  article: KbArticle;
  /** Number of weighted keyword hits; >= 2 is treated as a real match. */
  score: number;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[’']/g, "'");
}

/** Keyword-overlap search over the KB. Deterministic and dependency-free. */
export function searchKb(query: string, limit = 3): KbMatch[] {
  const q = normalize(query);
  return KB.map((article) => {
    let score = 0;
    for (const kw of article.keywords) {
      if (q.includes(kw)) score += kw.includes(" ") ? 2 : 1;
    }
    if (q.includes(article.title.toLowerCase())) score += 2;
    return { article, score };
  })
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
