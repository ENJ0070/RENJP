import { createServerFn } from "@tanstack/react-start";
import type { Tables } from "@/integrations/supabase/types";

const ADMIN_TABLES = [
  "agents",
  "categories",
  "guide_steps",
  "products",
  "promos",
  "sellers",
  "settings",
  "shipping_rates",
  "social_links",
] as const;

type AdminTable = (typeof ADMIN_TABLES)[number];

const DEFAULT_ADMIN_USER = "admin";

function cleanToken(value: unknown) {
  return String(value ?? "").slice(0, 4000);
}

/** Verify admin credentials server-side and hand back a signed session token. */
export const adminLogin = createServerFn({ method: "POST" })
  .inputValidator((data: { username: string; passwordHash: string }) => {
    const username = String(data?.username ?? "").trim().slice(0, 100);
    const passwordHash = String(data?.passwordHash ?? "").trim();
    if (!username || !/^[a-f0-9]{64}$/.test(passwordHash)) throw new Error("Invalid credentials");
    return { username, passwordHash };
  })
  .handler(async ({ data }) => {
    const { issueToken } = await import("@/lib/session.server");
    const { LOCAL_ADMIN } = await import("@/data/local-accounts.server");

    // 1) Konto lokalne — działa zawsze, także bez połączenia z bazą.
    if (
      data.username.toLowerCase() === LOCAL_ADMIN.username.toLowerCase() &&
      data.passwordHash === LOCAL_ADMIN.passwordHash
    ) {
      return { ok: true as const, token: issueToken({ role: "admin" }) };
    }

    // 2) Konto zapisane w bazie (gdy jest dostępna).
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: rows } = await supabaseAdmin
        .from("settings")
        .select("key, value")
        .in("key", ["admin_username", "admin_password_hash"]);
      const map = Object.fromEntries((rows ?? []).map((r) => [r.key, r.value]));
      const expectedUser = map["admin_username"] || DEFAULT_ADMIN_USER;
      const expectedHash = map["admin_password_hash"] || "";
      if (
        expectedHash &&
        data.username.toLowerCase() === expectedUser.toLowerCase() &&
        data.passwordHash === expectedHash
      ) {
        return { ok: true as const, token: issueToken({ role: "admin" }) };
      }
    } catch {
      /* baza niedostępna — zostaje konto lokalne */
    }
    return { ok: false as const };
  });

/** Verify seller credentials server-side; password hashes never reach the browser. */
export const sellerLogin = createServerFn({ method: "POST" })
  .inputValidator((data: { username: string; passwordHash: string }) => {
    const username = String(data?.username ?? "").trim().slice(0, 100);
    const passwordHash = String(data?.passwordHash ?? "").trim();
    if (!username || !/^[a-f0-9]{64}$/.test(passwordHash)) throw new Error("Invalid credentials");
    return { username, passwordHash };
  })
  .handler(async ({ data }) => {
    const { issueToken } = await import("@/lib/session.server");
    const { LOCAL_SELLERS } = await import("@/data/local-accounts.server");
    const removed = await deletedLocalSellers();

    // 1) Konta lokalne (plik w kodzie) — działają bez bazy.
    const local = LOCAL_SELLERS.find(
      (s) =>
        s.active &&
        !removed.includes(s.id) &&
        s.username.toLowerCase() === data.username.toLowerCase(),
    );
    if (local && local.passwordHash === data.passwordHash) {
      return {
        ok: true as const,
        sellerId: local.id,
        token: issueToken({ role: "seller", sellerId: local.id }),
      };
    }

    // 2) Konta z bazy (gdy dostępna).
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: rows, error } = await supabaseAdmin
        .from("sellers")
        .select("id, username, password_hash, active")
        .eq("active", true);
      if (error) return { ok: false as const };
      const found = (rows ?? []).find(
        (s) => s.username.toLowerCase() === data.username.toLowerCase(),
      );
      if (found && found.password_hash === data.passwordHash) {
        return {
          ok: true as const,
          sellerId: found.id,
          token: issueToken({ role: "seller", sellerId: found.id }),
        };
      }
    } catch {
      /* baza niedostępna — zostają konta lokalne */
    }
    return { ok: false as const };
  });

/**
 * Single privileged write path for the admin and seller panels.
 * The browser never writes to the database directly: every mutation is
 * authorised here against a signed session token before it runs.
 */
export const secureMutate = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      token: string;
      table: string;
      op: "insert" | "update" | "upsert" | "delete";
      values?: unknown;
      id?: string | null;
    }) => {
      const table = String(data?.table ?? "");
      if (!(ADMIN_TABLES as readonly string[]).includes(table)) throw new Error("Unknown table");
      const op = String(data?.op ?? "");
      if (!["insert", "update", "upsert", "delete"].includes(op)) throw new Error("Unknown op");
      const id = data?.id == null ? null : String(data.id).slice(0, 100);
      if ((op === "update" || op === "delete") && !id) throw new Error("Missing id");
      return {
        token: cleanToken(data?.token),
        table: table as AdminTable,
        op: op as "insert" | "update" | "upsert" | "delete",
        values: data?.values ?? null,
        id,
      };
    },
  )
  .handler(async ({ data }) => {
    const { verifyToken } = await import("@/lib/session.server");
    const session = verifyToken(data.token);
    if (!session) return { error: "Unauthorized" };

    if (session.role === "seller") {
      // Sellers may only manage their own products and their own store row.
      if (!session.sellerId) return { error: "Unauthorized" };
      if (data.table === "sellers") {
        if (data.op !== "update" || data.id !== session.sellerId) return { error: "Unauthorized" };
      } else if (data.table !== "products") {
        return { error: "Unauthorized" };
      }
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (session.role === "seller" && (data.op === "update" || data.op === "delete")) {
      if (!data.id) return { error: "Unauthorized" };
      const { data: row } = await supabaseAdmin
        .from("products")
        .select("seller_id")
        .eq("id", data.id)
        .maybeSingle();
      if (!row || row.seller_id !== session.sellerId) return { error: "Unauthorized" };
    }

    const scopeValues = (values: unknown) => {
      if (session.role !== "seller") return values;
      if (data.table === "sellers") {
        const { password_hash: _p, username: _u, active: _a, ...rest } =
          (values ?? {}) as Record<string, unknown>;
        return rest;
      }
      const apply = (v: Record<string, unknown>) => ({ ...v, seller_id: session.sellerId });
      return Array.isArray(values)
        ? values.map((v) => apply(v as Record<string, unknown>))
        : apply((values ?? {}) as Record<string, unknown>);
    };

    const table = supabaseAdmin.from(data.table) as any;
    let error: { message: string } | null = null;

    if (data.op === "insert") ({ error } = await table.insert(scopeValues(data.values)));
    else if (data.op === "upsert") ({ error } = await table.upsert(scopeValues(data.values)));
    else if (data.op === "update")
      ({ error } = await table.update(scopeValues(data.values)).eq("id", data.id));
    else ({ error } = await table.delete().eq("id", data.id));

    return { error: error ? "Operation failed" : null };
  });

/** Admin-only: seller usernames (never password hashes) for the management UI. */
export const adminSellerUsernames = createServerFn({ method: "POST" })
  .inputValidator((data: { token: string }) => ({ token: cleanToken(data?.token) }))
  .handler(async ({ data }) => {
    const { verifyToken } = await import("@/lib/session.server");
    const session = verifyToken(data.token);
    if (!session || session.role !== "admin") return { usernames: {} as Record<string, string> };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin.from("sellers").select("id, username");
    return {
      usernames: Object.fromEntries((rows ?? []).map((r) => [r.id, r.username])) as Record<string, string>,
    };
  });

/** Admin-only product export so CSV never depends on a delayed/failed public browser query. */
export const adminExportProducts = createServerFn({ method: "POST" })
  .inputValidator((data: { token: string }) => ({ token: cleanToken(data?.token) }))
  .handler(async ({ data }) => {
    const { verifyToken } = await import("@/lib/session.server");
    const session = verifyToken(data.token);
    if (!session || session.role !== "admin") throw new Error("Unauthorized");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const all: Tables<"products">[] = [];
    for (let from = 0; from < 4000; from += 1000) {
      const { data: page, error } = await supabaseAdmin
        .from("products")
        .select("*")
        .order("display_order", { ascending: true })
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, Math.min(from + 999, 3999));
      if (error) throw new Error("Export failed");
      all.push(...((page ?? []) as Tables<"products">[]));
      if (!page || page.length < 1000) break;
    }
    return all;
  });

/** Publiczny licznik wyświetleń produktu — zwiększany po otwarciu karty. */
export const registerProductView = createServerFn({ method: "POST" })
  .inputValidator((data: { productId: string }) => {
    const productId = String(data?.productId ?? "");
    if (!/^[0-9a-fA-F-]{36}$/.test(productId)) throw new Error("Invalid product");
    return { productId };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("products")
      .select("views")
      .eq("id", data.productId)
      .maybeSingle();
    if (!row) return { ok: false as const };
    const next = (row.views ?? 0) + 1;
    await supabaseAdmin.from("products").update({ views: next }).eq("id", data.productId);
    return { ok: true as const, value: next };
  });

/** Upload an image through the server so the storage bucket needs no public write access. */
export const uploadImage = createServerFn({ method: "POST" })
  .inputValidator((data: { token: string; folder: string; ext: string; contentType: string; base64: string }) => {
    const folder = String(data?.folder ?? "uploads").replace(/[^a-zA-Z0-9/_-]/g, "").slice(0, 60) || "uploads";
    const ext = String(data?.ext ?? "jpg").replace(/[^a-zA-Z0-9]/g, "").slice(0, 6) || "jpg";
    const contentType = String(data?.contentType ?? "application/octet-stream");
    if (!contentType.startsWith("image/")) throw new Error("Only image uploads are allowed");
    const base64 = String(data?.base64 ?? "");
    if (!base64 || base64.length > 14_000_000) throw new Error("Invalid file");
    return { token: cleanToken(data?.token), folder, ext, contentType, base64 };
  })
  .handler(async ({ data }) => {
    const { verifyToken } = await import("@/lib/session.server");
    if (!verifyToken(data.token)) throw new Error("Unauthorized");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const bytes = Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0));
    const path = `${data.folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${data.ext}`;
    const { error } = await supabaseAdmin.storage.from("product-images").upload(path, bytes, {
      cacheControl: "31536000",
      contentType: data.contentType,
      upsert: false,
    });
    if (error) throw new Error("Upload failed");
    // Public bucket URLs work in preview and after publishing (including Vercel).
    const { data: publicFile } = supabaseAdmin.storage.from("product-images").getPublicUrl(path);
    if (!publicFile.publicUrl) throw new Error("Upload URL failed");
    return { url: publicFile.publicUrl };
  });

/** Public shipping rates incl. coupon fields, served server-side so they are not exposed via the public data API. */
export const getShippingRates = createServerFn({ method: "GET" }).handler(async () => {
  const { LOCAL_SHIPPING_RATES } = await import("@/data/localShipping");
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("shipping_rates")
      .select("*")
      .order("sort_order");
    if (error || !data?.length) throw new Error("no rows");
    return JSON.parse(JSON.stringify(data)) as any[];
  } catch {
    // Brak bazy (np. hosting bez kluczy) — używamy cennika zapisanego w kodzie.
    return JSON.parse(JSON.stringify(LOCAL_SHIPPING_RATES)) as any[];
  }
});

async function deletedLocalSellers(): Promise<string[]> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("settings")
      .select("value")
      .eq("key", "deleted_local_sellers")
      .maybeSingle();
    const v = JSON.parse(data?.value || "[]");
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

/** Admin-only: usuwa sprzedawcę razem z jego produktami (także konto wbudowane w kod). */
export const adminDeleteSeller = createServerFn({ method: "POST" })
  .inputValidator((data: { token: string; id: string }) => ({
    token: cleanToken(data?.token),
    id: String(data?.id ?? "").slice(0, 100),
  }))
  .handler(async ({ data }) => {
    const { verifyToken } = await import("@/lib/session.server");
    const session = verifyToken(data.token);
    if (!session || session.role !== "admin") return { error: "Unauthorized" };
    if (!data.id) return { error: "Missing id" };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: pErr } = await supabaseAdmin.from("products").delete().eq("seller_id", data.id);
    if (pErr) return { error: "Operation failed" };
    const { error: sErr } = await supabaseAdmin.from("sellers").delete().eq("id", data.id);
    if (sErr) return { error: "Operation failed" };
    const { LOCAL_SELLERS } = await import("@/data/local-accounts.server");
    if (LOCAL_SELLERS.some((s) => s.id === data.id)) {
      const list = Array.from(new Set([...(await deletedLocalSellers()), data.id]));
      const { error } = await supabaseAdmin
        .from("settings")
        .upsert({ key: "deleted_local_sellers", value: JSON.stringify(list) }, { onConflict: "key" });
      if (error) return { error: "Operation failed" };
    }
    return { error: null };
  });

/** Admin-only: usuwa WSZYSTKIE produkty (opcjonalnie tylko danego sprzedawcy) po potwierdzeniu hasłem. */
export const adminDeleteAllProducts = createServerFn({ method: "POST" })
  .inputValidator((data: { token: string; passwordHash: string; sellerId?: string | null }) => ({
    token: cleanToken(data?.token),
    passwordHash: String(data?.passwordHash ?? "").trim(),
    sellerId: data?.sellerId ? String(data.sellerId).slice(0, 100) : null,
  }))
  .handler(async ({ data }) => {
    const { verifyToken } = await import("@/lib/session.server");
    const session = verifyToken(data.token);
    if (!session || session.role !== "admin") return { error: "Unauthorized", deleted: 0 };
    const { LOCAL_ADMIN } = await import("@/data/local-accounts.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let ok = data.passwordHash === LOCAL_ADMIN.passwordHash;
    if (!ok) {
      const { data: row } = await supabaseAdmin
        .from("settings")
        .select("value")
        .eq("key", "admin_password_hash")
        .maybeSingle();
      ok = !!row?.value && row.value === data.passwordHash;
    }
    if (!ok) return { error: "Wrong password", deleted: 0 };
    let q = supabaseAdmin.from("products").delete({ count: "exact" });
    q = data.sellerId ? q.eq("seller_id", data.sellerId) : q.not("id", "is", null);
    const { error, count } = await q;
    if (error) return { error: "Operation failed", deleted: 0 };
    return { error: null, deleted: count ?? 0 };
  });
