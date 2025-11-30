import os
import json
import logging
from tqdm import tqdm

# --- Config ---
DATASET_DIR = r"C:\Users\Demo_\Downloads\armoureye\Datasets"
# Input: The validated master file
INPUT_FILE = os.path.join(DATASET_DIR, "MASTER_package_dataset_validated.jsonl")
# Output: The *simplified* fine-tuning dataset
OUTPUT_FILE = os.path.join(DATASET_DIR, "finetuning_dataset_simplified.jsonl")

logging.basicConfig(level=logging.INFO, format="%(message)s")

# Helper function to get the highest severity score (used for sorting only)
def get_severity_score(severity_str):
    severity_str = (severity_str or "UNKNOWN").upper()
    if severity_str == "CRITICAL": return 4
    if severity_str == "HIGH": return 3
    if severity_str == "MEDIUM": return 2
    if severity_str == "LOW": return 1
    return 0

def generate_summary_paragraph(pkg_name, pkg_version, vulnerabilities):
    """Generates a natural language summary paragraph."""
    if not vulnerabilities:
        return f"Package {pkg_name} version {pkg_version} appears CLEAN based on the dataset. No vulnerabilities were found."

    status = "VULNERABLE"
    severity_counts = {"CRITICAL": 0, "HIGH": 0, "MEDIUM": 0, "LOW": 0, "UNKNOWN": 0}
    has_exploits = False
    has_fixes = False

    for vuln in vulnerabilities:
        sev = (vuln.get("severity") or "UNKNOWN").upper()
        if sev in severity_counts:
            severity_counts[sev] += 1
        else:
            severity_counts["UNKNOWN"] += 1
        if vuln.get("exploits"): has_exploits = True
        if vuln.get("fixes"): has_fixes = True

    total_vulns = len(vulnerabilities)
    summary_parts = []
    if severity_counts["CRITICAL"] > 0: summary_parts.append(f"{severity_counts['CRITICAL']} CRITICAL")
    if severity_counts["HIGH"] > 0: summary_parts.append(f"{severity_counts['HIGH']} HIGH")
    if severity_counts["MEDIUM"] > 0: summary_parts.append(f"{severity_counts['MEDIUM']} MEDIUM")
    if severity_counts["LOW"] > 0: summary_parts.append(f"{severity_counts['LOW']} LOW")
    if severity_counts["UNKNOWN"] > 0: summary_parts.append(f"{severity_counts['UNKNOWN']} UNKNOWN")
    severity_breakdown = ", ".join(summary_parts) if summary_parts else "severity unclear"

    paragraph = f"Package {pkg_name} version {pkg_version} is {status}. "
    paragraph += f"It has {total_vulns} known vulnerabilities ({severity_breakdown}). "
    paragraph += f"Exploit information is {'available' if has_exploits else 'not readily available'}. "
    paragraph += f"Fix information is {'available' if has_fixes else 'not readily available'}."

    return paragraph.strip()

# --- Main Execution ---
if __name__ == "__main__":
    logging.info(f"Loading data from {INPUT_FILE}...")
    try:
        with open(INPUT_FILE, 'r', encoding='utf-8') as f:
            lines = f.readlines()
        all_package_records = [json.loads(line) for line in lines if line.strip()]
    except FileNotFoundError:
        logging.error(f"FATAL: Input file not found: {INPUT_FILE}")
        exit()
    except Exception as e:
        logging.error(f"FATAL: Failed to load or parse input file: {e}")
        exit()

    logging.info(f"Loaded {len(all_package_records)} package records. Starting conversion to simplified fine-tuning format...")

    simplified_finetuning_data = []

    for package_data in tqdm(all_package_records, desc="Converting to Prompt/Completion"):
        pkg_name = package_data.get("package")
        pkg_version = package_data.get("installed_version")
        vulnerabilities = package_data.get("vulnerabilities", [])

        if not pkg_name or not pkg_version:
            logging.warning(f"Skipping record due to missing package name or version.")
            continue

        # --- 1. Create the Prompt ---
        prompt = f"Analyze package: {pkg_name} version: {pkg_version}"

        # --- 2. Create the SIMPLIFIED Completion ---

        # Generate the summary paragraph
        summary_text = generate_summary_paragraph(pkg_name, pkg_version, vulnerabilities)

        # Format 'all_vulnerabilities' - Keep essential info + status
        formatted_vulns = []
        for vuln in vulnerabilities:
             formatted_vulns.append({
                 "cve_id": vuln.get("cve_id"),
                 "severity": vuln.get("severity"),
                 "cvss": vuln.get("cvss"),
                 "description": vuln.get("description"),
                 "exploits": vuln.get("exploits", []), # Keep links with status
                 "fixes": vuln.get("fixes", [])       # Keep links with status
             })

        # Build final completion object (simplified structure)
        completion = {
            "report_summary_text": summary_text,
            "all_vulnerabilities": formatted_vulns
        }

        # Add the prompt/completion pair
        simplified_finetuning_data.append({
            "prompt": prompt,
            "completion": completion
        })

    logging.info(f"Conversion complete. Writing {len(simplified_finetuning_data)} records to {OUTPUT_FILE}...")

    # --- Write the Final Fine-tuning File ---
    try:
        with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
            for entry in simplified_finetuning_data:
                # Write each prompt/completion pair as a JSON line
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")

        logging.info(f"\n✅ Successfully wrote SIMPLIFIED fine-tuning data to {OUTPUT_FILE}")

    except Exception as e:
        logging.error(f"Failed to write final output file: {e}")

    logging.info("\nAll done.")