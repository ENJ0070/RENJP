import { useCallback, useEffect, useState } from "react";

import { QcGrid } from "@/components/QcViewer";
import { QcLoading } from "@/components/QcLoading";

export type QcPage = {
  ok: boolean;
  title: string;
  images: string[];
  totalPhotos: number;
  hasMore: boolean;
  source: string;
};

const STEP = 6;

/** Galeria QC z FinderQC: 6 zdjęć na start i przycisk „Pokaż więcej”. */
export function QcPhotos({
  loadPage,
  autoLoad = false,
  initialImages,
  cols,
  showMore = true,
  emptyText = "Nie znaleziono zdjęć QC.",
  buttonText = "Pokaż więcej",
  startText = "Pokaż zdjęcia QC",
}: {
  loadPage: (page: number) => Promise<QcPage>;
  autoLoad?: boolean;
  /** Zdjęcia znane od razu (np. zapisane przy produkcie) — widoczne bez klikania. */
  initialImages?: string[];
  cols?: string;
  /** Pokazuj przycisk dociągania kolejnych zdjęć. */
  showMore?: boolean;
  emptyText?: string;
  buttonText?: string;
  startText?: string;
}) {
  const [images, setImages] = useState<string[]>(initialImages ?? []);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [shown, setShown] = useState(STEP);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);

  const fetchNext = useCallback(async () => {
    setBusy(true);
    setTouched(true);
    const next = page + 1;
    const started = Date.now();
    try {
      const res = await loadPage(next);
      const wait = 900 - (Date.now() - started);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      setImages((prev) => Array.from(new Set([...prev, ...res.images])));
      setHasMore(res.hasMore);
      setPage(next);
      setShown((s) => Math.max(s, next === 1 ? STEP : s + STEP));
    } catch {
      setHasMore(false);
    } finally {
      setBusy(false);
    }
  }, [loadPage, page]);

  useEffect(() => {
    if (autoLoad && page === 0 && !busy) void fetchNext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLoad]);

  useEffect(() => {
    if (!initialImages?.length) return;
    setImages((prev) => Array.from(new Set([...initialImages, ...prev])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialImages?.join("|")]);

  function more() {
    if (shown < images.length) {
      setShown((s) => s + STEP);
      if (images.length - shown <= STEP && hasMore) void fetchNext();
      return;
    }
    if (hasMore) void fetchNext();
  }

  const canShowMore = shown < images.length || hasMore;

  return (
    <div className="space-y-3">
      {images.length > 0 ? <QcGrid images={images.slice(0, shown)} {...(cols ? { cols } : {})} /> : null}
      {busy ? <QcLoading seconds={images.length ? 2 : 4} /> : null}
      {!busy && touched && images.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface-deep p-4 text-center text-sm text-muted-foreground">
          {emptyText}
        </p>
      ) : null}
      {!busy && canShowMore ? (
        <button
          onClick={more}
          className="w-full rounded-lg border border-border px-3 py-2 text-center text-xs font-bold uppercase tracking-wide text-primary transition-colors hover:border-primary"
        >
          {images.length === 0 ? startText : buttonText}
        </button>
      ) : null}
    </div>
  );
}
