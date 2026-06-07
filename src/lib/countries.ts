// Lista curta de países comuns; o usuário pode escolher outros pelo código ISO-2.
export const COUNTRIES: { code: string; name: string }[] = [
  { code: "BR", name: "Brasil" },
  { code: "PT", name: "Portugal" },
  { code: "US", name: "Estados Unidos" },
  { code: "AR", name: "Argentina" },
  { code: "CL", name: "Chile" },
  { code: "UY", name: "Uruguai" },
  { code: "PY", name: "Paraguai" },
  { code: "CO", name: "Colômbia" },
  { code: "MX", name: "México" },
  { code: "ES", name: "Espanha" },
  { code: "IT", name: "Itália" },
  { code: "FR", name: "França" },
  { code: "DE", name: "Alemanha" },
  { code: "GB", name: "Reino Unido" },
  { code: "CA", name: "Canadá" },
  { code: "JP", name: "Japão" },
];

/** Converte código ISO-2 (ex. "BR") em emoji de bandeira. */
export function countryFlag(code?: string | null): string {
  if (!code || code.length !== 2) return "";
  const cc = code.toUpperCase();
  const A = 0x1f1e6;
  const base = "A".charCodeAt(0);
  return String.fromCodePoint(A + cc.charCodeAt(0) - base, A + cc.charCodeAt(1) - base);
}

/** Calcula idade a partir de uma data (string ISO YYYY-MM-DD ou Date). */
export function ageFromBirthDate(birth?: string | null): number | null {
  if (!birth) return null;
  const d = new Date(birth);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age >= 0 && age < 150 ? age : null;
}
