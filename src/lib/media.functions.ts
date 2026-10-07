import { createServerFn } from "@tanstack/react-start";

/** Publiczne wyszukiwanie zdjęć QC po linku Weidian / Taobao / 1688 / agenta. */
export const lookupQc = createServerFn({ method: "POST" })
  .inputValidator((data: { url: string }) => {
    const url = String(data?.url ?? "").trim().slice(0, 2000);
    if (!/^https?:\/\//i.test(url)) throw new Error("Nieprawidłowy link.");
    return { url };
  })
  .handler(async ({ data }) => {
    const { fetchAgentDetails } = await import("@/lib/agentApi");
    const details = await fetchAgentDetails(data.url).catch(() => null);
    if (!details) return { ok: false as const, error: "not-found" };
    return {
      ok: true as const,
      title: details.title,
      priceCny: details.priceCny,
      images: details.images,
      colorImages: details.colorImages,
      qcImages: details.qcImages,
      sizes: details.sizes,
    };
  });

/**
 * Uzupełnia zdjęcia produktów (galeria, kolorystyki, QC) z otwartego API agenta.
 * Wywoływane z panelu admina — wymaga podpisanego tokenu sesji.
 */
export const syncProductMedia = createServerFn({ method: "POST" })
  .inputValidator((data: { token: string; limit?: number; onlyMissing?: boolean; cursor?: string }) => ({
    token: String(data?.token ?? "").slice(0, 4000),
    limit: Math.min(100, Math.max(1, Number(data?.limit) || 40)),
    onlyMissing: data?.onlyMissing !== false,
    cursor: String(data?.cursor ?? "").slice(0, 100),
  }))
  .handler(async ({ data }) => {
    const { verifyToken } = await import("@/lib/session.server");
    const session = verifyToken(data.token);
    if (!session || session.role !== "admin") throw new Error("Unauthorized");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { fetchAgentDetails, productSourceUrl } = await import("@/lib/agentApi");
    const { archiveProductImages } = await import("@/lib/image-storage.server");

    let query = supabaseAdmin
      .from("products")
      .select("id, image_url, images, qc_images, store_url, qc_url, agent_links")
      .order("id", { ascending: true })
      .limit(data.limit);
    if (data.cursor) query = query.gt("id", data.cursor);

    const { data: rows, error } = await query;
    if (error) throw new Error("Nie udało się pobrać produktów.");

    let updated = 0;
    let skipped = 0;
    const items = rows ?? [];
    for (let i = 0; i < items.length; i += 5) {
      const chunk = items.slice(i, i + 5);
      await Promise.all(
        chunk.map(async (p: any) => {
          const external = (u: string) => /^https?:\/\//i.test(u);
          const mainOk = Boolean(p.image_url && external(p.image_url));
          const currentImages = (p.images ?? []).filter(external);
          const currentQc = (p.qc_images ?? []).filter(external);
          const archived = await archiveProductImages({ image_url: p.image_url, images: currentImages, qc_images: currentQc });
          if (JSON.stringify(archived) !== JSON.stringify({ image_url: p.image_url, images: currentImages, qc_images: currentQc })) {
            const { error: archiveError } = await supabaseAdmin.from("products").update(archived).eq("id", p.id);
            if (archiveError) throw new Error("Nie udało się zapisać kopii zdjęć.");
            p.image_url = archived.image_url;
            currentImages.splice(0, currentImages.length, ...archived.images);
            currentQc.splice(0, currentQc.length, ...archived.qc_images);
            updated++;
          }
          if (data.onlyMissing && mainOk && currentImages.length && currentQc.length) {
            return void skipped++;
          }

          const src = productSourceUrl(p);
          if (!src) return void skipped++;
          const [{ fetchFinderQcByUrl }, details] = await Promise.all([
            import("@/lib/finderqc.server"),
            fetchAgentDetails(src).catch(() => null),
          ]);
          const finder = currentQc.length
            ? null
            : await fetchFinderQcByUrl(src, 1, 10).catch(() => null);
          if (!details) return void skipped++;

          const images = Array.from(
            new Set([...currentImages, ...details.colorImages, ...details.images]),
          ).slice(0, 24);
          const qc = Array.from(
            new Set([...currentQc, ...(finder?.images ?? []), ...details.qcImages]),
          ).slice(0, 10);
          const patch: { images?: string[]; qc_images?: string[]; image_url?: string } = {};
          if ((!data.onlyMissing || !currentImages.length) && images.length) patch.images = images;
          if ((!data.onlyMissing || !currentQc.length) && qc.length) patch.qc_images = qc;
           if (!mainOk && images[0]) patch.image_url = images[0];
          if (!Object.keys(patch).length) return void skipped++;

          const savedPatch = await archiveProductImages(patch);
          const { error: upErr } = await supabaseAdmin.from("products").update(savedPatch).eq("id", p.id);
          if (upErr) skipped++;
          else updated++;
        }),
      );
    }

    return {
      ok: true as const,
      checked: items.length,
      updated,
      skipped,
      nextCursor: items.length === data.limit ? String(items.at(-1)?.id ?? "") : "",
    };
  });
