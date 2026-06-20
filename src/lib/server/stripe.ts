import Stripe from "stripe";

import { requiredEnv } from "@/lib/server/env";

let stripe: Stripe | null = null;

export function stripeClient() {
  stripe ??= new Stripe(requiredEnv("STRIPE_SECRET_KEY"));
  return stripe;
}
