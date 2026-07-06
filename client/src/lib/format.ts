import type { Currency } from "@shared";

const nf0 = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat("es-ES", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// null → "–": una métrica no calculable no se disfraza de cero
export const fmtInt = (n: number | null | undefined) =>
  n === null || n === undefined ? "–" : nf0.format(n);

export const fmtMoney = (
  n: number | null | undefined,
  currency: Currency = "EUR"
) =>
  n === null || n === undefined
    ? "–"
    : `${nf2.format(n)} ${currency === "GBP" ? "£" : "€"}`;

export const fmtPct = (n: number | null | undefined, decimals = 1) =>
  n === null || n === undefined
    ? "–"
    : `${new Intl.NumberFormat("es-ES", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }).format(n * 100)} %`;

export const fmtRatio = (n: number | null | undefined) =>
  n === null || n === undefined ? "–" : nf2.format(n);

export function acosColor(
  acos: number | null,
  target: number,
  spend: number
): string {
  if (acos === null)
    return spend > 0 ? "text-bad" : "text-faint"; // gasto sin ventas: rojo
  if (acos <= target) return "text-good";
  if (acos <= target * 1.5) return "text-warn";
  return "text-bad";
}
