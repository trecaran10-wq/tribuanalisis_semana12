"use strict";

function decimalHundredths(text) {
  const match = /^(\d+)(?:\.(\d*))?(?:e([+-]?\d{1,2}))?$/i.exec(text);
  if (!match || text.length > 64) return null;
  const fraction = match[2] || "";
  const shift = 2 - fraction.length + Number(match[3] || 0);
  if (shift > 40 || shift < -40) return null;
  const value = BigInt(match[1] + fraction);
  if (shift >= 0) return value * 10n ** BigInt(shift);
  const divisor = 10n ** BigInt(-shift);
  return value % divisor === 0n ? value / divisor : null;
}

function enteredHundredths(value) {
  if (!/^\d{1,16}(?:[.,]\d{1,2})?$/.test(value)) return null;
  return decimalHundredths(value.replace(",", "."));
}

function calculateTaxValues(recorded, calculation) {
  const nonAdmitted = calculation.non_admitted ? enteredHundredths(calculation.non_admitted) : null;
  const rate = calculation.tax_rate ? enteredHundredths(calculation.tax_rate) : null;
  let error = "";
  if (recorded === null) error = "Revisa el monto registrado en el primer paso.";
  else if (calculation.non_admitted && nonAdmitted === null) error = "El importe no admitido debe ser un número no negativo con hasta dos decimales.";
  else if (nonAdmitted !== null && nonAdmitted > recorded) error = "El importe no admitido no puede superar el gasto registrado.";
  else if (calculation.tax_rate && (rate === null || rate > 10000n)) error = "La tasa debe estar entre 0 y 100 %, con hasta dos decimales.";
  const deductible = !error && nonAdmitted !== null ? recorded - nonAdmitted : null;
  const tax = deductible !== null && rate !== null ? (nonAdmitted * rate + 5000n) / 10000n : null;
  return { recorded, nonAdmitted, deductible, tax, error };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { decimalHundredths, calculateTaxValues };
}
