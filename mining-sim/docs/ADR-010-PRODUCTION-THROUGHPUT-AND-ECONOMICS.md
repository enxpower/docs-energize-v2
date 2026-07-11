# ADR-010: Production Throughput and Operating Economics

## Status
Accepted

## Decision
V7 converts production power into throughput with an explicit per-load power-law model:

- `normalThroughputTPH`
- `normalMW`
- `throughputExponent`

Actual, potential, and deferred production are accumulated independently from EENS.

Diesel fuel consumption is calculated from explicit per-generator curves containing:

- idle liters per hour;
- incremental liters per MWh;
- fuel price per liter.

BESS economic value is limited to an explicitly labeled estimate of displaced diesel fuel based on configured marginal liters per MWh. It is not treated as full project value.

## Boundaries
The model does not claim:

- detailed process metallurgy or ore-recovery performance;
- validated OEM fuel curves unless project data are supplied;
- full operating profit;
- NPV, IRR, tax, financing, depreciation, maintenance, or replacement economics;
- guaranteed BESS savings.

All prices, throughput curves, and fuel curves are project assumptions until calibrated against mine and vendor data.

## Required evidence
Every economic sample must expose:

- current and normal throughput;
- actual and deferred tons;
- diesel liters and fuel cost;
- production gross value and deferred value;
- BESS discharged energy and estimated avoided fuel cost;
- valuation-method assumptions.
