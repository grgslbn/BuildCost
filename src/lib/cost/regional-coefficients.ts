/**
 * Belgian regional reconstruction cost coefficients, indexed by postcode range.
 * Source: user-defined calibration table (2026).
 * Coefficient 1.000 = national reference; values < 1 = below national average.
 */

const REGIONAL_RANGES: Array<{ from: number; to: number; coeff: number; label: string }> = [
  { from: 1000, to: 1210, coeff: 1.000, label: "Brussel-stad (19 gemeenten kernstad)" },
  { from: 1300, to: 1499, coeff: 0.967, label: "Waals-Brabant (Wavre, Ottignies)" },
  { from: 1500, to: 1999, coeff: 0.987, label: "Vlaams-Brabant rand (Halle, Vilvoorde, Asse)" },
  { from: 2000, to: 2060, coeff: 0.987, label: "Antwerpen-stad" },
  { from: 2070, to: 2999, coeff: 0.967, label: "Provincie Antwerpen (buiten stad)" },
  { from: 3000, to: 3499, coeff: 0.967, label: "Leuven + Hageland" },
  { from: 3500, to: 3999, coeff: 0.953, label: "Hasselt + Limburg centraal" },
  { from: 4000, to: 4999, coeff: 0.953, label: "Luik + provincie" },
  { from: 5000, to: 5999, coeff: 0.940, label: "Namen + provincie" },
  { from: 6000, to: 6599, coeff: 0.920, label: "Charleroi + Henegouwen oost" },
  { from: 6600, to: 6999, coeff: 0.940, label: "Luxemburg Belgisch (Arlon, Bastogne)" },
  { from: 7000, to: 7999, coeff: 0.940, label: "Henegouwen west (Bergen, Tournai, Moeskroen)" },
  { from: 8000, to: 8299, coeff: 0.973, label: "Brugge + regio" },
  { from: 8300, to: 8699, coeff: 0.987, label: "Kust (Knokke, Oostende, De Panne)" },
  { from: 8700, to: 8999, coeff: 0.967, label: "West-Vlaanderen binnenland (Roeselare, Kortrijk)" },
  { from: 9000, to: 9299, coeff: 0.973, label: "Gent + Meetjesland" },
  { from: 9300, to: 9999, coeff: 0.953, label: "Oost-Vlaanderen buiten Gent (Aalst, Dendermonde, Sint-Niklaas)" },
];

export type RegionalLookupResult = {
  coeff: number;
  label: string;
  postcode: string;
};

/**
 * Returns the regional coefficient for a Belgian postcode string.
 * Falls back to 1.000 if the postcode is null, unparseable, or not in any range.
 */
export function getRegionalCoefficient(postcode: string | null | undefined): RegionalLookupResult {
  if (!postcode) return { coeff: 1.000, label: "onbekend (geen postcode)", postcode: "" };

  const pc = parseInt(postcode.trim(), 10);
  if (isNaN(pc)) return { coeff: 1.000, label: "onbekend (ongeldige postcode)", postcode: postcode };

  for (const range of REGIONAL_RANGES) {
    if (pc >= range.from && pc <= range.to) {
      return { coeff: range.coeff, label: range.label, postcode: postcode.trim() };
    }
  }

  // Postcode parsed but not in any defined range (e.g. 1211-1299 gap)
  return { coeff: 1.000, label: "onbekend (postcode buiten tabel)", postcode: postcode.trim() };
}
