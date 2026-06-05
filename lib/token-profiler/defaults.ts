/**
 * Pre-filled example so the profiler shows something interesting on load with
 * zero input. The tool set is deliberately realistic: a small `get_weather`
 * plus a chunky `search_knowledge_base` whose verbose schema is the kind of
 * hidden, every-turn cost the tool is built to surface.
 */
import type { ModelId } from "./pricing";

export const DEFAULT_SYSTEM_PROMPT = `You are a helpful support agent for an e-commerce store.

Be concise, friendly, and accurate. Always use the available tools to look up
real order, product, and shipping data instead of guessing. Never invent an
order status, tracking number, or refund policy — if a tool returns nothing,
say so and offer to escalate to a human. When you give a final answer, keep it
to a few short sentences and avoid restating the customer's question.`;

export const DEFAULT_TOOL_JSON = `[
  {
    "name": "get_weather",
    "description": "Get the current weather for a city, used when a customer asks about delivery conditions.",
    "input_schema": {
      "type": "object",
      "properties": { "city": { "type": "string", "description": "City name, e.g. 'Tunis'." } },
      "required": ["city"]
    }
  },
  {
    "name": "get_order_status",
    "description": "Look up the status of a customer order by its ID.",
    "input_schema": {
      "type": "object",
      "properties": {
        "order_id": { "type": "string", "description": "The order ID, e.g. 'ORD-10482'." }
      },
      "required": ["order_id"]
    }
  },
  {
    "name": "search_knowledge_base",
    "description": "Search the internal knowledge base of help articles, product specifications, return and refund policies, warranty terms, billing rules, account procedures, and shipping rules. Use this tool for ANY question about how the store operates: policy details, product compatibility, troubleshooting steps, fees, timelines, or region-specific rules. It performs a hybrid semantic + keyword search across all published help content and returns the most relevant articles, each with an ID, title, category, and (optionally) a text excerpt. ALWAYS prefer calling this tool over guessing or recalling policy from memory, because policies change frequently and vary by region. You can narrow the search by category, product line, and locale, request more or fewer results, and choose whether to include excerpts. Excerpts are truncated server-side to keep responses readable; if you need the full article, follow up with the article ID. Do not paraphrase warranty or refund terms without citing the article you used. If no article matches, say so plainly and offer to escalate to a human agent rather than inventing an answer.",
    "input_schema": {
      "type": "object",
      "properties": {
        "query": { "type": "string", "description": "Natural-language search query describing exactly what the customer needs help with. Be specific; include product names, error messages, or policy terms the customer mentioned." },
        "category": { "type": "string", "enum": ["shipping", "returns", "warranty", "products", "billing", "account", "troubleshooting"], "description": "Optional category to narrow the search to a single area of the knowledge base." },
        "product_line": { "type": "string", "description": "Optional product line to scope results, e.g. 'aurora-series', 'nimbus-series'. Leave empty to search across all product lines." },
        "locale": { "type": "string", "description": "Optional BCP-47 locale for region-specific policy, e.g. 'en-US', 'fr-FR', 'de-DE'. Defaults to the customer's account locale when omitted." },
        "max_results": { "type": "integer", "minimum": 1, "maximum": 10, "description": "How many articles to return. Defaults to 3. Increase only when the first results were not relevant, since each extra article adds to the context." },
        "include_excerpts": { "type": "boolean", "description": "Whether to include text excerpts from each matched article. Defaults to true. Set false to get only titles and IDs when you just need to confirm an article exists." },
        "min_relevance": { "type": "number", "minimum": 0, "maximum": 1, "description": "Optional minimum relevance score (0–1). Articles below this are dropped. Defaults to 0.2." }
      },
      "required": ["query"]
    }
  }
]`;

/**
 * Two sample outputs. The first (weather) is tiny; the second (a knowledge-base
 * result with several full articles) is the kind of fat payload that quietly
 * inflates every turn it appears in — so the bloat detector will flag it.
 */
export const DEFAULT_TOOL_OUTPUTS: string[] = [
  `{"city":"Tunis","temp_c":24,"conditions":"clear","wind_kph":12}`,
  `{
  "results": [
    {
      "id": "KB-2231",
      "title": "Return & Refund Policy (2026)",
      "category": "returns",
      "excerpt": "Items may be returned within 30 days of delivery for a full refund, provided they are unused and in original packaging. Opened consumables are non-refundable. Refunds are issued to the original payment method within 5–7 business days of our receiving the return. Return shipping is free for defective items; otherwise a flat 4.99 USD label fee applies and is deducted from the refund. Gift returns are issued as store credit."
    },
    {
      "id": "KB-1188",
      "title": "Aurora Series — Charging & Compatibility",
      "category": "products",
      "excerpt": "The Aurora Series ships with a USB-C PD charger and supports 5V/9V/12V profiles up to 45W. Third-party chargers must be USB-PD certified; non-certified chargers may limit charging to 15W and can void the fast-charge warranty. The Aurora Mini is not compatible with the Aurora dock; use the Mini-specific cradle (sold separately)."
    },
    {
      "id": "KB-0907",
      "title": "International Shipping & Customs",
      "category": "shipping",
      "excerpt": "We ship to 40+ countries. Duties and import taxes are calculated at checkout where possible (DDP); for DDU destinations the carrier collects on delivery. Typical transit is 5–9 business days; remote regions may add 3–5 days. Tracking updates can lag 24–48h after dispatch. We cannot redirect a parcel once it has cleared export."
    },
    {
      "id": "KB-1450",
      "title": "Warranty Coverage & Claims",
      "category": "warranty",
      "excerpt": "All Aurora and Nimbus products carry a 24-month limited warranty covering manufacturing defects. The warranty does not cover accidental damage, water ingress beyond the rated IP class, or damage from non-certified accessories. To file a claim, provide the order ID and a short description of the fault; approved claims are repaired or replaced free of charge, and we cover return shipping for warranty repairs. Battery capacity degradation below 80% within the first 12 months is covered; normal wear after that is not. Out-of-warranty repairs are quoted before any work begins."
    }
  ],
  "total_matches": 4,
  "query_echo": "what is your return policy and is the aurora mini dock compatible"
}`,
];

export const DEFAULT_USER_MESSAGE =
  "Hi! I ordered the Aurora Mini last week (order ORD-10482) and I want to return it — what's your policy, and does it work with the standard dock?";

export const DEFAULT_ASSISTANT_MESSAGE =
  "Thanks for reaching out! Your order ORD-10482 shipped yesterday and is in transit. You can return the Aurora Mini within 30 days of delivery for a full refund as long as it's unused and in its original packaging. One heads-up: the Aurora Mini isn't compatible with the standard dock — it needs the Mini-specific cradle. Want me to share a link to that cradle or start a return for you?";

export const DEFAULT_TOOL_CALLS_PER_TURN = 3;
export const DEFAULT_TURNS = 100;
export const DEFAULT_PRIMARY_MODEL: ModelId = "claude-sonnet-4-6";
