import argparse
import sys
import os

# Add parent directory to path to allow importing validate_offer_file
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from validate_offer_file import validate_file

def generate_report(file_path, output_report_path=None):
    result = validate_file(file_path)
    
    report_lines = []
    report_lines.append(f"# Amazon Offer File Validation Report")
    report_lines.append(f"**Target File**: `{os.path.basename(file_path)}`  ")
    report_lines.append(f"**Status**: {'✅ SUCCESS - Ready to Upload' if result['status'] == 'SUCCESS' else '❌ FAILED - Resolve Errors Before Uploading'}  ")
    report_lines.append(f"**Date Verified**: {os.getenv('CURRENT_DATE', '2026-07-02')}  \n")
    
    report_lines.append("## Summary Statistics")
    report_lines.append("| Metric | Count |")
    report_lines.append("| :--- | :---: |")
    report_lines.append(f"| Verified SKUs | {result['stats'].get('total_sku_rows', 0)} |")
    report_lines.append(f"| Unique SKUs | {result['stats'].get('unique_skus', 0)} |")
    report_lines.append(f"| Duplicate SKUs | {result['stats'].get('duplicates', 0)} |")
    report_lines.append(f"| Critical Errors | {result['stats'].get('errors', 0)} |")
    report_lines.append("")

    if result['errors']:
        report_lines.append("## ❌ Critical Errors Found")
        for err in result['errors']:
            report_lines.append(f"- [ ] {err}")
        report_lines.append("")
        
    if result['warnings']:
        report_lines.append("## ⚠️ Warnings & Suggestions")
        for warn in result['warnings']:
            report_lines.append(f"- {warn}")
        report_lines.append("")
        
    if result['status'] == "SUCCESS":
        report_lines.append("## ✅ Verification Checklist Passed")
        report_lines.append("- [x] All SKUs present and unique.")
        report_lines.append("- [x] Pricing validations (standard price > sale price > 0) correct.")
        report_lines.append("- [x] FBM listings set to 'DEFAULT' fulfillment code.")
        report_lines.append("- [x] Promotional date ranges structured in correct price schedule columns.")
        report_lines.append("- [x] Dates chronological and formatted as YYYY-MM-DD.")
        report_lines.append("\n**Conclusion**: The file is compliant with Amazon upload standards.")
        
    report_content = "\n".join(report_lines)
    
    if output_report_path:
        with open(output_report_path, 'w', encoding='utf-8') as f:
            f.write(report_content)
        print(f"Validation report saved to {output_report_path}")
    else:
        print(report_content)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate Markdown Validation Report for Amazon Offer File")
    parser.add_argument("--file", required=True, help="Path to the Excel file to validate")
    parser.add_argument("--output", help="Path to save the validation report (.md)")
    
    args = parser.parse_args()
    generate_report(args.file, args.output)
