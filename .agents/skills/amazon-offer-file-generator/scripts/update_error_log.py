import argparse
import os
from datetime import date

def append_error(marketplace, file_type, description, amazon_message, root_cause, solution, new_rule, prevent_strategy):
    log_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'references', 'error-log.md')
    
    if not os.path.exists(log_path):
        # Create it if it doesn't exist
        with open(log_path, 'w', encoding='utf-8') as f:
            f.write("# Amazon Upload Error Log\n\nThis log lists errors encountered during upload attempts to Amazon, their diagnostics, and how they were solved.\n")

    today_str = date.today().isoformat()
    
    log_entry = f"""
---

## [{today_str}] - {description}
- **Marketplace afectado**: {marketplace}
- **Tipo de fichero**: {file_type}
- **Descripción del error**: {description}
- **Mensaje de error de Amazon**: `{amazon_message}`
- **Causa raíz**: {root_cause}
- **Solución aplicada**: {solution}
- **Regla nueva para la Skill**: {new_rule}
- **Cómo prevenir**: {prevent_strategy}
"""

    with open(log_path, 'a', encoding='utf-8') as f:
        f.write(log_entry)
        
    print(f"Successfully added error entry for '{description}' to error-log.md")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Add new upload error to Amazon Error Log")
    parser.add_argument("--marketplace", required=True, help="Affected marketplace (e.g. ES, US, DE)")
    parser.add_argument("--file-type", required=True, help="Type of offer/pricing file")
    parser.add_argument("--description", required=True, help="Short description of the error")
    parser.add_argument("--amazon-message", required=True, help="Exact error message from Amazon")
    parser.add_argument("--root-cause", required=True, help="Root cause of the failure")
    parser.add_argument("--solution", required=True, help="Solution applied to resolve the issue")
    parser.add_argument("--new-rule", required=True, help="New validation rule to be added to the skill")
    parser.add_argument("--prevent", required=True, help="Strategy to prevent this error from recurring")
    
    args = parser.parse_args()
    
    append_error(
        args.marketplace,
        args.file_type,
        args.description,
        args.amazon_message,
        args.root_cause,
        args.solution,
        args.new_rule,
        args.prevent
    )
