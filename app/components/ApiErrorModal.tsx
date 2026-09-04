"use client";

interface ApiErrorModalProps {
  message: string;
  onClose: () => void;
  /**
   * "infra" (default) — a request that DID get a response, but a bad one
   * (5xx, unparseable/unexpected body): our infrastructure's fault.
   * Renders exactly as before this variant existed — untouched, so this
   * popup's established meaning doesn't drift.
   *
   * "timeout" (ALV-94) — a request that never got a response at all before
   * our own client-side deadline: more likely the user's connection than
   * our backend. Visually distinct (amber accent + heading) precisely so
   * it's never confused with the infra case above — different cause,
   * different message, different fix on the user's end.
   */
  variant?: "infra" | "timeout";
}

/**
 * Generic overlay for infrastructure-level API failures (5xx, network
 * errors, unparseable/unexpected responses) — never for handled business
 * validation errors (400/422 with a known { error } shape), which keep
 * showing inline where they already were.
 */
export default function ApiErrorModal({
  message,
  onClose,
  variant = "infra",
}: ApiErrorModalProps) {
  const isTimeout = variant === "timeout";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        className={`w-full max-w-sm rounded-lg bg-white p-5 shadow-lg dark:bg-zinc-900 ${
          isTimeout ? "border-l-4 border-amber-500" : ""
        }`}
      >
        {isTimeout && (
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
            Tiempo de espera agotado
          </p>
        )}
        <p className="text-sm text-zinc-900 dark:text-zinc-100">{message}</p>
        <button
          type="button"
          onClick={onClose}
          className={`mt-4 w-full rounded-md px-4 py-2 text-sm font-medium text-white ${
            isTimeout
              ? "bg-amber-600 hover:bg-amber-700"
              : "bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          }`}
        >
          Entendido
        </button>
      </div>
    </div>
  );
}
