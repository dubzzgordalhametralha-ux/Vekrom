import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import type { Page } from "../../lib/api";
import { mapMessages, upsertNewest } from "../../lib/realtime";
import { toastError } from "../../lib/store";

/**
 * Histórico paginado (keyset) + envio otimista.
 * pages[0] = 50 mais recentes; as próximas são mais antigas.
 */
export function useHistory<T extends { id: string; createdAt: string }>(
  key: unknown[],
  fetchPage: (before?: string) => Promise<Page<T>>,
  enabled = true,
) {
  const qc = useQueryClient();
  const q = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
    staleTime: 60_000,
  });
  const items = useMemo(() => (q.data ? [...q.data.pages].reverse().flatMap((p) => p.items) : []), [q.data]);

  /** Mostra na hora como "enviando"; troca pela real quando a API responde. Falha vira "tentar de novo". */
  async function sendOptimistic(draft: Omit<T, "id" | "createdAt">, post: () => Promise<T>) {
    const tmp = { ...draft, id: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, createdAt: new Date().toISOString(), pending: true } as unknown as T;
    upsertNewest(qc, key, tmp);
    try {
      upsertNewest(qc, key, await post(), tmp.id);
    } catch (e) {
      mapMessages<T>(qc, key, (m) => (m.id === tmp.id ? ({ ...m, pending: false, failed: true } as T) : m));
      toastError(e);
    }
  }

  return { ...q, items, sendOptimistic, qc };
}
