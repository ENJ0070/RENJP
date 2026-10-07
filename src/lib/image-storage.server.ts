import { supabaseAdmin } from "@/integrations/supabase/client.server";

const ALLOWED = ["geilicdn.com", "alicdn.com", "finderqc.com", "usfans.com", "uufinds.com", "kakobyy.com", "yupoo.com"];
const MAX_BYTES = 10 * 1024 * 1024;

/** Copy known product CDN images into durable storage; failures never erase originals. */
export async function archiveImage(source: string): Promise<string> {
  try {
    const url = new URL(source.startsWith("//") ? `https:${source}` : source);
    if (url.protocol !== "https:" || !ALLOWED.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) return source;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url.href));
    const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
    const path = `archive/${hash}.img`;
    const bucket = supabaseAdmin.storage.from("product-images");
    const publicUrl = bucket.getPublicUrl(path).data.publicUrl;
    const existing = await fetch(publicUrl, { method: "HEAD" });
    if (existing.ok) return publicUrl;
    const response = await fetch(url, { redirect: "error", headers: { Referer: "https://weidian.com/" } });
    const type = response.headers.get("content-type")?.split(";")[0] ?? "";
    if (!response.ok || !/^image\/(jpeg|png|webp|gif|avif)$/.test(type)) return source;
    if (Number(response.headers.get("content-length")) > MAX_BYTES) return source;
    const reader = response.body?.getReader();
    if (!reader) return source;
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > MAX_BYTES) { await reader.cancel(); return source; }
      chunks.push(part.value);
    }
    if (!length) return source;
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const { error } = await bucket.upload(path, bytes, { contentType: type, cacheControl: "31536000", upsert: false });
    if (error && !/already exists|duplicate/i.test(error.message)) return source;
    return publicUrl;
  } catch { return source; }
}

export async function archiveProductImages<T extends Record<string, unknown>>(row: T): Promise<T> {
  const patch: Record<string, unknown> = { ...row };
  const urls = Array.from(new Set([
    ...(typeof row['image_url'] === "string" ? [row['image_url']] : []),
    ...(Array.isArray(row['images']) ? row['images'].filter((u): u is string => typeof u === "string") : []),
    ...(Array.isArray(row['qc_images']) ? row['qc_images'].filter((u): u is string => typeof u === "string") : []),
  ]));
  const copies = new Map<string, string>();
  for (let i = 0; i < urls.length; i += 3) {
    await Promise.all(urls.slice(i, i + 3).map(async (url) => copies.set(url, await archiveImage(url))));
  }
  if (typeof row['image_url'] === "string") patch['image_url'] = copies.get(row['image_url']) ?? row['image_url'];
  for (const key of ["images", "qc_images"]) {
    if (Array.isArray(row[key])) patch[key] = row[key].map((u) => typeof u === "string" ? copies.get(u) ?? u : u);
  }
  return patch as T;
}