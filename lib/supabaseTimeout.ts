// Shared across every Supabase query in the project — API routes, the cron,
// and the one-off maintenance scripts alike. Deliberately its own file, not
// part of lib/supabase.ts: some scripts (see scripts/seed-initial.ts) load
// their own .env.local manually and can't import lib/supabase.ts, since
// that file's module-scope createClient(process.env...) call would run
// before those scripts have populated process.env themselves. This file
// reads nothing from process.env and has no side effects at import time, so
// it's always safe to import first, from anywhere.
//
// ALV-95: no Supabase query anywhere in this project had an explicit
// timeout before this — a hung/slow response had no cap beyond whatever
// the caller's own outer budget happened to be (a route's default
// execution limit, or the cron's maxDuration). 5s is generous for what are
// all simple, indexed queries against small tables; normal operation
// should never come close to it.
export const SUPABASE_TIMEOUT_MS = 5_000;

/**
 * A fresh AbortSignal for a single Supabase query — chain it as
 * `.abortSignal(supabaseTimeoutSignal())` on any query builder.
 *
 * This must stay a function, not a shared constant: an AbortSignal.timeout()
 * signal starts its clock the instant it's created, not when it's attached
 * to a request. Reusing one signal across multiple queries would mean every
 * query after the first effectively inherits however much of the 5s budget
 * the earlier ones already burned through — a call late in a loop could
 * start out already-expired. A fresh call here means every query gets its
 * own full 5s, independent of how long anything before it took.
 */
export function supabaseTimeoutSignal(): AbortSignal {
  return AbortSignal.timeout(SUPABASE_TIMEOUT_MS);
}
