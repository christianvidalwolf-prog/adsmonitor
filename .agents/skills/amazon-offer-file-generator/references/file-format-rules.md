# Amazon File Format Rules

This file documents the structure and format constraints of Amazon's listings templates.

## 1. Sheet Structure (Price and Quantity)
The spreadsheet contains several worksheets, but the upload data is in the **`Plantilla`** worksheet.
- **Row 1 (0-indexed 0)**: Ingest settings metadata string. *Do not modify or delete.*
- **Row 2 (0-indexed 1)**: Language warning row ("Debes rellenar esta plantilla en ESPAÑOL..."). *Do not modify or delete.*
- **Row 3 (0-indexed 2)**: Listing category display headers (e.g. "Identidad de listing"). *Do not modify or delete.*
- **Row 4 (0-indexed 3)**: Friendly column headers (e.g. "SKU", "Cantidad (ES)"). *Do not modify or delete.*
- **Row 5 (0-indexed 4)**: Technical column headers / attribute mappings (e.g. `contribution_sku#1.value`). *Do not modify or delete.*
- **Row 6 (0-indexed 5)**: Example data row (starts with `ABC123`). This row can be kept in the sheet as it serves as a guide for the ingestion system.
- **Row 7 onwards (0-indexed 6 onwards)**: Active data rows.

## 2. Macro-Enabled Spreadsheet (`.xlsm`)
- The file is a macro-enabled workbook.
- When loading and saving via automated Python scripts, **always use `keep_vba=True`** in `openpyxl.load_workbook`. If VBA is stripped, the workbook macros will fail and Amazon's ingestion validation might reject the file.

## 3. Numeric Formatting & Decimals
- Prices must be floating-point numbers.
- When writing float values via Python `openpyxl`, write them as numeric float objects (not strings). This allows Excel to format them automatically based on the user's regional settings (comma as decimal in ES, dot in US).
- Pre-round all prices to exactly **two decimal places** (e.g. `10.95`, `8.21`) to avoid precision truncation errors during upload.

## 4. Date Fields
- Dates must be represented as strings in `YYYY-MM-DD` format (e.g. `2026-07-02`).
- Setting cells to Python `datetime.date` is accepted, but string formatting ensures consistent behavior regardless of Excel formatting constraints.
