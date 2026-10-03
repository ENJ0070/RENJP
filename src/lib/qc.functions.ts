import { createServerFn } from "@tanstack/react-start";

/**
 * Zdjęcia QC dla konkretnego produktu z katalogu.
 * Najpierw baza, potem pobranie na żywo z magazynu agenta (USFans / Kakobuy —
 * oba korzystają z tego samego magazynu QC), max 10 zdjęć. Wynik jest cache'owany
 * w bazie, żeby kolejne wejścia były natychmiastowe.
 */
export const qcForProduct = createServerFn({ method: "POST" })
  .inputValidator((data: { productId: string }) => {
    const productId = String(data?.productId ?? "").trim();
    if (!/^[0-9a-f-]{10,64}$/i.test(productId)) throw new Error("Nieprawidłowy produkt.");
    return { productId };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { fetchUsfansDetails, productSourceUrl } = await import("@/lib/agentApi");

    const { data: row } = await supabaseAdmin
      .from("products")
      .select("id, title, qc_images, store_url, qc_url, agent_links")
      .eq("id", data.productId)
      .maybeSingle();

    if (!row) return { ok: false as const, title: "", images: [] as string[] };

    const stored = ((row as any).qc_images ?? []).filter((u: string) =>
      /^https?:\/\//i.test(u),
    ) as string[];
    if (stored.length) {
      return { ok: true as const, title: (row as any).title as string, images: stored.slice(0, 10) };
    }

    const src = productSourceUrl(row as any);
    if (!src) return { ok: true as const, title: (row as any).title as string, images: [] };

    const details = await fetchUsfansDetails(src).catch(() => null);
    const images = (details?.qcImages ?? []).slice(0, 10);
    if (images.length) {
      await supabaseAdmin.from("products").update({ qc_images: images }).eq("id", data.productId);
    }
    return { ok: true as const, title: (row as any).title as string, images };
  });
