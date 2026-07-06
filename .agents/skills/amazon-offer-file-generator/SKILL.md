---
name: "Amazon Offer File Generator & Validator"
description: "Localized skill to generate, validate, and debug Excel/CSV Price and Quantity/Offer files for Amazon Seller and Vendor Central."
---

# Amazon Offer File Generator & Validator

This custom skill provides guidelines, validation checks, and diagnostic tools to ensure that price and quantity/promotion files generated for Amazon Seller and Vendor Central are correct, fully compliant, and free of upload errors.

## When to Use
- **Generation**: When creating or modifying Excel (`.xlsx`, `.xlsm`) or CSV templates for Amazon Price and Quantity updates.
- **Validation**: Before exporting or uploading the generated files to Amazon Seller/Vendor Central.
- **Troubleshooting**: When an upload to Amazon results in errors, validation failures, or processing reports containing warnings.

## Pre-Export Checklist
Before finalizing and uploading any offer file, ensure:
1. [ ] **SKU Validation**: All SKUs exist, are active, and are correctly formatted.
2. [ ] **Fulfillment Channel**: For merchant-fulfilled (FBM) listings, `fulfillment_channel_code` is explicitly set to `DEFAULT` (do not leave empty). For FBA, set correctly (e.g., `AMZN_EU`) and omit manual quantity updates.
3. [ ] **Price Limits**: `Tu precio EUR` (Standard Price) is numeric, and `Precio de venta. EUR` (Sale Price) is less than or equal to the Standard Price.
4. [ ] **Sale Price Dates**: When setting a sale price, both the general offer dates and the sale schedule columns (`discounted_price...start_at/end_at`) must be populated.
5. [ ] **Decimal Separators**: Confirm the decimal separators match the template format (use dot/float values natively, or localized commas as strings if required by the legacy parser).
6. [ ] **Template Integrity**: All 5 header rows (warning, category, friendly header, technical header, example row) are preserved exactly.

## Reference Materials
- [Amazon Validation Rules](references/amazon-validation-rules.md)
- [File Format Rules](references/file-format-rules.md)
- [Error Log](references/error-log.md)
- [Known Fixes](references/known-fixes.md)
- [Update Workflow](references/update-workflow.md)

## Automated Scripts
- **Validation**: Run `python3 scripts/validate_offer_file.py --file <path_to_file>` to run automated sanity checks.
- **Error Logging**: Run `python3 scripts/update_error_log.py --error "<msg>"` to append an error to the logs.
