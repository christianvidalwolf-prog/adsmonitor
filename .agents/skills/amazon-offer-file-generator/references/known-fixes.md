# Amazon Upload Known Fixes

This document compiles quick fixes for common errors encountered when uploading price and quantity templates to Amazon Seller/Vendor Central.

## 1. Error: "Fulfillment channel code does not have enough values"
- **Symptom**: Column `fulfillment_channel_code` is empty, leading to listing rejection.
- **Fix**: 
  - For Seller Fulfilled listings (FBM), write **`DEFAULT`** into column `fulfillment_channel_code` (Friendly: `Cumplimiento de código de canal (ES)`).
  - For Amazon Fulfilled listings (FBA), write **`AMAZON_EU`** (or appropriate marketplace equivalent) and clear any custom quantity updates.

## 2. Error: "schedule.start_at / schedule.end_at does not have enough values"
- **Symptom**: Sale price is set, but dates are empty or rejected.
- **Fix**:
  - Make sure the start and end dates of the promotional discount are written to:
    - Column `purchasable_offer[marketplace_id=A1RKKUPIHCS9HS][audience=ALL]#1.discounted_price#1.schedule#1.start_at` (Col 11 / L)
    - Column `purchasable_offer[marketplace_id=A1RKKUPIHCS9HS][audience=ALL]#1.discounted_price#1.schedule#1.end_at` (Col 10 / K)
  - Format the dates strictly as `YYYY-MM-DD` (e.g. `2026-07-02`).

## 3. Error: "Price validation errors or price too high/low"
- **Symptom**: Minimum/maximum price boundaries cause listings to be deactivated.
- **Fix**:
  - `tu_precio` (Standard Price) must always be set.
  - `precio_minimo_permitido` (Min Price) should be set to half the Standard Price (e.g., `Standard Price * 0.5`).
  - `precio_maximo_permitido` (Max Price) should be set to double the Standard Price (e.g., `Standard Price * 2.0`).
  - `precio_de_venta` (Sale Price) must be less than the Standard Price and greater than or equal to the Min Price.

## 4. Error: "VBA Macros stripped or file corrupted"
- **Symptom**: Amazon returns a format error because Excel macros are missing.
- **Fix**: Ensure that the Python scripts modifying `.xlsm` files always load the workbook with `keep_vba=True`. Do not convert `.xlsm` templates to standard `.xlsx` files during processing.
