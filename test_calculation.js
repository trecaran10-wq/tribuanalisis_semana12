"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { decimalHundredths, calculateTaxValues } = require("./calculation.js");

test("no se presupone deducción ni tasa", () => {
  const pending = calculateTaxValues(300000n, { non_admitted: "", tax_rate: "" });
  assert.equal(pending.deductible, null);
  assert.equal(pending.tax, null);
  const noAdjustment = calculateTaxValues(300000n, { non_admitted: "0", tax_rate: "" });
  assert.equal(noAdjustment.deductible, 300000n);
  assert.equal(noAdjustment.nonAdmitted, 0n);
  assert.equal(noAdjustment.tax, null);
});

test("usa centavos exactos y redondea la incidencia", () => {
  const result = calculateTaxValues(300000n, { non_admitted: "125,50", tax_rate: "29,5" });
  assert.equal(result.deductible, 287450n);
  assert.equal(result.tax, 3702n);
  assert.equal(calculateTaxValues(300000n, { non_admitted: "0.05", tax_rate: "10" }).tax, 1n);
  assert.equal(decimalHundredths("1e3"), 100000n);
  assert.equal(decimalHundredths("0.001"), null);
});

test("rechaza datos inválidos y reparos mayores al gasto", () => {
  for (const calculation of [
    { non_admitted: "3000.01", tax_rate: "" },
    { non_admitted: "-1", tax_rate: "" },
    { non_admitted: "1.001", tax_rate: "" },
    { non_admitted: "1", tax_rate: "100.01" }
  ]) {
    const result = calculateTaxValues(300000n, calculation);
    assert.ok(result.error);
    assert.equal(result.deductible, null);
  }
});
