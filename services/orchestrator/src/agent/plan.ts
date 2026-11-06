import { config } from "../config.js";
import { chatJson } from "../inference/client.js";

export interface Requirements {
  product_category: string;
  quantity: number;
  budget_usd: number;
  deadline_business_days: number;
  min_power_delivery_w: number;
  min_external_4k_displays: number;
  ship_to: string;
  must_haves: string[];
}

export interface Plan {
  requirements: Requirements;
  supplier_goal: string;
  selection_rule: string;
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    requirements: {
      type: "object",
      additionalProperties: false,
      properties: {
        product_category: { type: "string" },
        quantity: { type: "integer" },
        budget_usd: { type: "number" },
        deadline_business_days: { type: "integer" },
        min_power_delivery_w: { type: "number" },
        min_external_4k_displays: { type: "integer" },
        ship_to: { type: "string" },
        must_haves: { type: "array", items: { type: "string" } },
      },
      required: ["product_category", "quantity", "budget_usd", "deadline_business_days", "min_power_delivery_w", "min_external_4k_displays", "ship_to", "must_haves"],
    },
    supplier_goal: { type: "string" },
    selection_rule: { type: "string" },
  },
  required: ["requirements", "supplier_goal", "selection_rule"],
};

/** Turn the purchasing request into structured requirements and the instruction each portal visit follows. */
export async function plan(task: string, defaults: Partial<Requirements>): Promise<{ plan: Plan; model: string }> {
  const { value, result } = await chatJson<Plan>(
    {
      model: config.inference.models.planner,
      temperature: 0,
      max_tokens: 2000,
      reasoning_effort: "low",
      messages: [
        {
          role: "system",
          content:
            "You plan purchasing errands for a company's buyer. Extract hard requirements from the request. " +
            "`supplier_goal` is the instruction for visiting ONE supplier portal: sign in, find every product that could satisfy the requirements, and record each one's account price, stock, lead time, shipping and volume tiers. Never order during this visit. " +
            "`selection_rule` states how to pick the winner across suppliers (eligibility first, then lowest landed cost).",
        },
        { role: "user", content: `Request: ${task}\nKnown values (use when the request is silent): ${JSON.stringify(defaults)}` },
      ],
    },
    "errand_plan",
    SCHEMA,
  );
  return { plan: value, model: result.model };
}
