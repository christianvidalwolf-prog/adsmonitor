import pandas as pd
import openpyxl
import argparse
import os
import re
from datetime import datetime

def parse_date(date_str):
    if not date_str:
        return None
    try:
        # Standard format
        return datetime.strptime(str(date_str).strip(), '%Y-%m-%d').date()
    except ValueError:
        return None

def validate_file(file_path):
    issues = []
    
    if not os.path.exists(file_path):
        return {"status": "ERROR", "errors": [f"File {file_path} does not exist."], "warnings": [], "stats": {}}
        
    ext = os.path.splitext(file_path)[1].lower()
    if ext not in ['.xlsx', '.xlsm']:
        return {"status": "ERROR", "errors": [f"Unsupported file format {ext}. Only .xlsx and .xlsm are supported."], "warnings": [], "stats": {}}

    print(f"Loading {file_path} for validation...")
    try:
        # Load sheets
        xls = pd.ExcelFile(file_path)
        sheet_name = None
        for s in ['Vorlage', 'Plantilla']:
            if s in xls.sheet_names:
                sheet_name = s
                break
        
        if not sheet_name:
            return {"status": "ERROR", "errors": ["Sheet 'Vorlage' or 'Plantilla' is missing in the workbook."], "warnings": [], "stats": {}}
            
        df = pd.read_excel(file_path, sheet_name=sheet_name, header=None)
    except Exception as e:
        return {"status": "ERROR", "errors": [f"Failed to read the excel file: {e}"], "warnings": [], "stats": {}}
        
    # Check minimum rows (5 header rows + 1 example row = 6 rows)
    if len(df) < 6:
        return {"status": "ERROR", "errors": [f"Workbook has too few rows ({len(df)}). Must contain at least 5 header rows and 1 example row."], "warnings": [], "stats": {}}

    # Map column headers to search for technical mappings
    tech_headers = df.iloc[4].tolist()
    
    # Find the actual marketplace_id in the technical headers row
    marketplace_id = "A1RKKUPIHCS9HS" # default to ES (Spain)
    for h_val in tech_headers:
        if pd.notnull(h_val) and 'marketplace_id=' in str(h_val):
            match = re.search(r'marketplace_id=([A-Z0-9]+)', str(h_val))
            if match:
                marketplace_id = match.group(1)
                break
    
    # Locate required columns based on technical header strings
    col_mapping = {}
    expected_techs = {
        'sku': 'contribution_sku#1.value',
        'fulfillment_channel': 'fulfillment_availability#1.fulfillment_channel_code',
        'quantity': 'fulfillment_availability#1.quantity',
        'handling_time': 'fulfillment_availability#1.lead_time_to_ship_max_days',
        'standard_price': f'purchasable_offer[marketplace_id={marketplace_id}][audience=ALL]#1.our_price#1.schedule#1.value_with_tax',
        'min_price': f'purchasable_offer[marketplace_id={marketplace_id}][audience=ALL]#1.minimum_seller_allowed_price#1.schedule#1.value_with_tax',
        'max_price': f'purchasable_offer[marketplace_id={marketplace_id}][audience=ALL]#1.maximum_seller_allowed_price#1.schedule#1.value_with_tax',
        'sale_price': f'purchasable_offer[marketplace_id={marketplace_id}][audience=ALL]#1.discounted_price#1.schedule#1.value_with_tax',
        'sale_start_schedule': f'purchasable_offer[marketplace_id={marketplace_id}][audience=ALL]#1.discounted_price#1.schedule#1.start_at',
        'sale_end_schedule': f'purchasable_offer[marketplace_id={marketplace_id}][audience=ALL]#1.discounted_price#1.schedule#1.end_at',
        'offer_start': f'purchasable_offer[marketplace_id={marketplace_id}][audience=ALL]#1.start_at.value',
        'offer_end': f'purchasable_offer[marketplace_id={marketplace_id}][audience=ALL]#1.end_at.value',
    }

    # Find the indices of columns in our sheet matching expected techs
    for label, tech_name in expected_techs.items():
        found = False
        for c_idx, h_val in enumerate(tech_headers):
            if str(h_val).strip() == tech_name:
                col_mapping[label] = c_idx
                found = True
                break
        if not found:
            issues.append(f"Warning: Tech header '{tech_name}' for '{label}' was not found in the columns.")
            
    # Check if SKU column exists (absolutely required)
    if 'sku' not in col_mapping:
        return {"status": "ERROR", "errors": ["SKU column (contribution_sku#1.value) not found. Check template format."], "warnings": issues, "stats": {}}

    sku_idx = col_mapping['sku']
    data_rows = df.iloc[6:] # rows 7 onwards (0-indexed 6)
    
    unique_skus = set()
    duplicate_skus = set()
    row_count = 0
    errors_found = 0
    warnings_found = 0
    
    validation_details = []

    for r_idx, row in data_rows.iterrows():
        excel_row_num = r_idx + 1
        sku_val = row[sku_idx]
        if pd.isnull(sku_val) or str(sku_val).strip() == "":
            issues.append(f"Row {excel_row_num}: SKU is empty.")
            errors_found += 1
            continue
            
        sku = str(sku_val).strip()
        row_count += 1
        
        # Check unique SKU
        if sku in unique_skus:
            duplicate_skus.add(sku)
            issues.append(f"Row {excel_row_num}: Duplicate SKU '{sku}' found.")
            errors_found += 1
        unique_skus.add(sku)
        
        row_issues = []
        
        # Validate Standard Price
        std_price_val = None
        if 'standard_price' in col_mapping:
            val = row[col_mapping['standard_price']]
            if pd.notnull(val):
                try:
                    std_price_val = float(str(val).replace(',', '.'))
                    if std_price_val <= 0:
                        row_issues.append(f"Standard price {std_price_val} must be positive.")
                except ValueError:
                    row_issues.append(f"Standard price '{val}' is not a valid number.")
                    
        # Validate Sale Price
        sale_price_val = None
        if 'sale_price' in col_mapping:
            val = row[col_mapping['sale_price']]
            if pd.notnull(val):
                try:
                    sale_price_val = float(str(val).replace(',', '.'))
                    if sale_price_val <= 0:
                        row_issues.append(f"Sale price {sale_price_val} must be positive.")
                    elif std_price_val and sale_price_val > std_price_val:
                        row_issues.append(f"Sale price {sale_price_val} cannot be greater than Standard Price {std_price_val}.")
                except ValueError:
                    row_issues.append(f"Sale price '{val}' is not a valid number.")

        # Validate Min / Max Prices
        if 'min_price' in col_mapping and std_price_val:
            val = row[col_mapping['min_price']]
            if pd.notnull(val):
                try:
                    min_price = float(str(val).replace(',', '.'))
                    if min_price > std_price_val:
                        row_issues.append(f"Minimum allowed price {min_price} is higher than Standard Price {std_price_val}.")
                except ValueError:
                    row_issues.append(f"Min price '{val}' is not a valid number.")
        if 'max_price' in col_mapping and std_price_val:
            val = row[col_mapping['max_price']]
            if pd.notnull(val):
                try:
                    max_price = float(str(val).replace(',', '.'))
                    if max_price < std_price_val:
                        row_issues.append(f"Maximum allowed price {max_price} is lower than Standard Price {std_price_val}.")
                except ValueError:
                    row_issues.append(f"Max price '{val}' is not a valid number.")

        # Validate Fulfillment Channel Code
        if 'fulfillment_channel' in col_mapping:
            f_code = row[col_mapping['fulfillment_channel']]
            qty_val = row[col_mapping['quantity']] if 'quantity' in col_mapping else None
            
            # If quantity is updated, fulfillment channel must not be empty
            if pd.notnull(qty_val) and str(qty_val).strip() != "":
                if pd.isnull(f_code) or str(f_code).strip() == "":
                    row_issues.append("Fulfillment channel code is empty but quantity is defined. FBM listings must be set to 'DEFAULT'.")
                elif str(f_code).strip() not in ['DEFAULT', 'AMAZON_EU', 'AMAZON_NA', 'AMAZON_EU_VCS']:
                    row_issues.append(f"Fulfillment channel code '{f_code}' is unusual. Expected 'DEFAULT' or 'AMAZON_EU'.")

        # Validate Promotion Dates & Price Schedules
        if sale_price_val:
            # Sale price is specified, checking sale schedule dates
            s_start = col_mapping.get('sale_start_schedule')
            s_end = col_mapping.get('sale_end_schedule')
            
            start_date_val = str(row[s_start]).strip() if s_start is not None and pd.notnull(row[s_start]) else None
            end_date_val = str(row[s_end]).strip() if s_end is not None and pd.notnull(row[s_end]) else None
            
            if not start_date_val or start_date_val == "":
                row_issues.append("Sale price schedule start date ('discounted_price...start_at') is empty but sale price is defined.")
            if not end_date_val or end_date_val == "":
                row_issues.append("Sale price schedule end date ('discounted_price...end_at') is empty but sale price is defined.")
                
            # Date validation
            d1 = parse_date(start_date_val) if start_date_val else None
            d2 = parse_date(end_date_val) if end_date_val else None
            
            if start_date_val and not d1:
                row_issues.append(f"Sale start date '{start_date_val}' has invalid format. Use 'YYYY-MM-DD'.")
            if end_date_val and not d2:
                row_issues.append(f"Sale end date '{end_date_val}' has invalid format. Use 'YYYY-MM-DD'.")
                
            if d1 and d2 and d1 > d2:
                row_issues.append(f"Sale start date '{start_date_val}' is after end date '{end_date_val}'.")

        # Collect issues
        if row_issues:
            errors_found += len(row_issues)
            for ri in row_issues:
                issues.append(f"Row {excel_row_num} (SKU: {sku}): {ri}")

    # Final stats
    stats = {
        "total_sku_rows": row_count,
        "unique_skus": len(unique_skus),
        "duplicates": len(duplicate_skus),
        "errors": errors_found
    }

    status = "SUCCESS" if errors_found == 0 else "FAILED"
    return {
        "status": status,
        "errors": [i for i in issues if "Warning:" not in i],
        "warnings": [i for i in issues if "Warning:" in i],
        "stats": stats
    }

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Validate Amazon Price and Quantity File")
    parser.add_argument("--file", required=True, help="Path to the Excel file to validate")
    args = parser.parse_args()
    
    result = validate_file(args.file)
    print(f"\n--- Validation Report: {result['status']} ---")
    print(f"Total Rows Verified: {result['stats'].get('total_sku_rows', 0)}")
    print(f"Total Errors Found: {result['stats'].get('errors', 0)}")
    
    if result['errors']:
        print("\nErrors:")
        for err in result['errors'][:20]: # print first 20 errors
            print(f" - {err}")
        if len(result['errors']) > 20:
            print(f" ... and {len(result['errors']) - 20} more errors.")
            
    if result['warnings']:
        print("\nWarnings:")
        for warn in result['warnings']:
            print(f" - {warn}")
            
    if result['status'] == "SUCCESS":
        print("\nAll checks passed successfully!")
        exit(0)
    else:
        exit(1)
