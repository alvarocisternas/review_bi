import { createClient } from "@supabase/supabase-js";

// Server-side only. SUPABASE_SECRET_KEY is the new secret key (sb_secret_...,
// the successor to the legacy service_role key) — it bypasses Row Level
// Security and grants full access to the database, so this client must
// never be imported from client components or any code that ships to the
// browser. Only import it from Next.js API routes (app/api/**/route.ts),
// the same rule we already follow for ANTHROPIC_API_KEY.
export const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
);
