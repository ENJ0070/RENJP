import { createServerFn } from "@tanstack/react-start";

/** Zdjęcia QC z FinderQC po wklejonym linku. */
export const finderQcByLink = createServerFn({ method: "POST" })
  .inputValidator((data: { url: string; page?: number; pageSize?: number }) => {
    const url = String(data?.url ?? "").trim().slice(0, 2000);
    if (!/^https?:\/\//i.test(url)) throw new Error("Nieprawidłowy link.");
    return {
      url,
      page: Math.min(50, Math.max(1, Number(data?.page) || 1)),
      pageSize: Math.min(12, Math.max(1, Number(data?.pageSize) || 4)),
    };
  })
  .handler(async ({ data }) => {
    const { fetchFinderQcByUrl } = await import("@/lib/finderqc.server");

    // Najpierw magazyn USFans — odpowiada od razu, więc wyszukiwarka nie zwalnia.
    if (data.page === 1) {
      const { fetchAgentDetails } = await import("@/lib/agentApi");
      const details = await fetchAgentDetails(data.url).catch(() => null);
      const images = (details?.qcImages ?? []).filter((u) => /^https?:\/\//i.test(u));
      if (images.length) {
        return {
          ok: true as const,
          title: details?.title ?? "",
          images,
          totalPhotos: images.length,
          hasMore: true,
          source: "",
        };
      }
    }

    // Zapas: katalog FinderQC (wolniejszy, chodzi przez pośrednika).
    return await fetchFinderQcByUrl(data.url, data.page, data.pageSize);
  });


/** Zdjęcia QC z FinderQC dla produktu z katalogu. */
export const finderQcByProduct = createServerFn({ method: "POST" })
  .inputValidator((data: { productId: string; page?: number; pageSize?: number }) => {
    const productId = String(data?.productId ?? "").trim();
    if (!/^[0-9a-f-]{10,64}$/i.test(productId)) throw new Error("Nieprawidłowy produkt.");
    return {
      productId,
      page: Math.min(50, Math.max(1, Number(data?.page) || 1)),
      pageSize: Math.min(12, Math.max(1, Number(data?.pageSize) || 4)),
    };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { productSourceUrl } = await import("@/lib/agentApi");
    const { fetchFinderQcByUrl } = await import("@/lib/finderqc.server");

    const { data: row } = await supabaseAdmin
      .from("products")
      .select("id, title, qc_images, store_url, qc_url, agent_links")
      .eq("id", data.productId)
      .maybeSingle();

    const empty = {
      ok: false as const,
      title: "",
      images: [] as string[],
      totalPhotos: 0,
      hasMore: false,
      source: "",
    };
    if (!row) return empty;

    const src = productSourceUrl(row as any);
    if (src) {
      const res = await fetchFinderQcByUrl(src, data.page, data.pageSize);
      if (res.ok && res.images.length) {
        return { ...res, title: (row as any).title || res.title };
      }
    }

    if (data.page > 1) return { ...empty, title: (row as any).title ?? "" };

    // Zapas 1: magazyn USFans (ma QC dla prawie każdego produktu).
    if (src) {
      const { fetchAgentDetails } = await import("@/lib/agentApi");
      const details = await fetchAgentDetails(src).catch(() => null);
      const usfans = (details?.qcImages ?? []).filter((u) => /^https?:\/\//i.test(u));
      if (usfans.length) {
        await supabaseAdmin
          .from("products")
          .update({ qc_images: usfans.slice(0, 10) })
          .eq("id", data.productId);
        return {
          ok: true as const,
          title: ((row as any).title as string) || details?.title || "",
          images: usfans,
          totalPhotos: usfans.length,
          hasMore: false,
          source: "",
        };
      }
    }

    // Zapas 2: zdjęcia QC zapisane wcześniej w bazie.

    const stored = (((row as any).qc_images ?? []) as string[]).filter((u) =>
      /^https?:\/\//i.test(u),
    );
    return {
      ok: stored.length > 0,
      title: ((row as any).title as string) ?? "",
      images: stored,
      totalPhotos: stored.length,
      hasMore: false,
      source: "",
    };
  });
