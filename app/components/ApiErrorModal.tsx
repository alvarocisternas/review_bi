"use client";

interface ApiErrorModalProps {
  message: string;
  onClose: () => void;
}

/**
 * Generic overlay for infrastructure-level API failures (5xx, network
 * errors, unparseable/unexpected responses) — never for handled business
 * validation errors (400/422 with a known { error } shape), which keep
 * showing inline where they already were.
 */
export default function ApiErrorModal({ message, onClose }: ApiErrorModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-lg dark:bg-zinc-900">
        <p className="text-sm text-zinc-900 dark:text-zinc-100">{message}</p>
        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Entendido
        </button>
      </div>
    </div>
  );
}
