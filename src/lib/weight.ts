/**
 * Szacowana waga wysyłkowa produktu (kg).
 * Na razie wyliczana z kategorii/nazwy — docelowo zastąpimy ją wagą z magazynu agenta.
 */

type WeightInput = {
  title?: string | null;
  category?: string | null;
};

const RULES: Array<{ re: RegExp; kg: number }> = [
  { re: /(buty|sneaker|shoe|jordan|dunk|yeezy|air\s?max|new\s?balance|samba|boots?|trampki)/i, kg: 1.5 },
  { re: /(kurtk|jacket|puffer|parka|płaszcz|plaszcz|coat|down)/i, kg: 1.4 },
  { re: /(bluza|hoodie|sweatshirt|crewneck|sweter|knit)/i, kg: 0.9 },
  { re: /(spodnie|pants|jeans|denim|cargo|dres|joggers|sweatpants)/i, kg: 0.8 },
  { re: /(plecak|backpack|torba|bag|tote|shoulder)/i, kg: 1.0 },
  { re: /(koszulka|t-?shirt|tee|polo|koszula|shirt)/i, kg: 0.4 },
  { re: /(szort|shorts|spodenki|skirt|spódnic|spodnic)/i, kg: 0.4 },
  { re: /(czapka|cap|beanie|hat|kapelusz)/i, kg: 0.25 },
  { re: /(skarpet|socks|pasek|belt|rękawic|rekawic|gloves|szalik|scarf)/i, kg: 0.25 },
  { re: /(zegarek|watch|okular|glasses|biżuter|bizuter|jewel|naszyjnik|bransolet|portfel|wallet)/i, kg: 0.3 },
];

/** Surowa szacowana waga produktu w kg. */
export function rawWeightKg(p: WeightInput): number {
  const text = `${p.category ?? ""} ${p.title ?? ""}`;
  for (const r of RULES) if (r.re.test(text)) return r.kg;
  return 0.6;
}

/** Zaokrąglenie w górę do 0,5 kg (min. 0,5 kg). */
export function roundHalfKg(kg: number): number {
  if (!Number.isFinite(kg) || kg <= 0) return 0.5;
  return Math.max(0.5, Math.ceil(kg * 2) / 2);
}

/** Szacowana waga produktu zaokrąglona do 0,5 kg — używana w koszyku i na karcie produktu. */
export function productWeightKg(p: WeightInput): number {
  return roundHalfKg(rawWeightKg(p));
}

/** Czytelny zapis wagi, np. „1,5 kg”. */
export function formatKg(kg: number): string {
  return `${kg.toFixed(1).replace(".", ",")} kg`;
}
