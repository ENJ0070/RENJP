import { useState, type ImgHTMLAttributes } from "react";
import { useLang } from "@/lib/i18n";

type Props = ImgHTMLAttributes<HTMLImageElement> & { fallbacks?: string[] };

function ImageAttempt({ src, fallbacks = [], className, alt, ...props }: Props) {
  const { t } = useLang();
  const candidates = Array.from(new Set([src, ...fallbacks].filter((u): u is string => Boolean(u))));
  const [index, setIndex] = useState(0);
  const current = candidates[index];
  if (!current) return <span className={`flex items-center justify-center bg-secondary text-xs text-muted-foreground ${className ?? ""}`}>{t("product.noImage")}</span>;
  return <img {...props} src={current} alt={alt ?? ""} className={className} referrerPolicy="no-referrer" decoding="async" onError={() => setIndex((i) => i + 1)} />;
}

/** Reset failed candidates only when the requested image actually changes. */
export function StableImage(props: Props) {
  return <ImageAttempt key={[props.src, ...(props.fallbacks ?? [])].join("|")} {...props} />;
}