#!/usr/bin/env python3
r"""
combine_data.py

Combines the package fingerprint lists with the enriched CVE lists.
It matches packages from the fingerprint file to the vulnerabilities
found in the enriched file.

Outputs:
  - <image>_combined.jsonl
"""

import os
import json
import logging

# ------- CONFIG -------
# Source of the fingerprint files
FINGERPRINT_DIR = r"C:\Windows\System32"
# Source of the enriched CVE files
ENRICHED_DIR = r"C:\Users\Demo_\Downloads\armoureye\Datasets"
# Destination for the new combined files
OUTPUT_DIR = r"C:\Users\Demo_\Downloads\armoureye\Datasets"

logging.basicConfig(level=logging.INFO, format="%(message)s")
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Define the file sets to process
APPS = ["dvwa", "juice", "metasploitable"]


def load_json_list(path):
    """Loads a standard JSON list file."""
    with open(path, "r", encoding="utf-8-sig") as f:
        return json.load(f)


def load_json_lines(path):
    """Loads a JSON-Lines file."""
    data = []
    with open(path, "r", encoding="utf-8-sig") as f:
        for line in f:
            if line.strip():
                try:
                    data.append(json.loads(line))
                except json.JSONDecodeError as e:
                    logging.warning(f"Skipping bad line in {path}: {e}")
    return data


def process_app(app_name):
    """Loads, combines, and saves data for one app."""
    
    fingerprint_file = os.path.join(FINGERPRINT_DIR, f"{app_name}_fingerprint.json")
    enriched_file = os.path.join(ENRICHED_DIR, f"{app_name}_cves_enriched.jsonl")
    combined_file = os.path.join(OUTPUT_DIR, f"{app_name}_combined.jsonl")

    # Check that input files exist
    if not os.path.isfile(fingerprint_file):
        logging.warning(f"Skipping: Cannot find fingerprint file {fingerprint_file}")
        return
    if not os.path.isfile(enriched_file):
        logging.warning(f"Skipping: Cannot find enriched file {enriched_file}")
        return

    logging.info(f"Processing {app_name}...")

    # 1. Load enriched CVE data and create a lookup map by package name
    enriched_data = load_json_lines(enriched_file)
    cve_map = {}
    for cve in enriched_data:
        pkg_name = cve.get("package")
        if not pkg_name:
            continue
        
        if pkg_name not in cve_map:
            cve_map[pkg_name] = []
        cve_map[pkg_name].append(cve)

    # 2. Load fingerprint data (list of installed packages)
    fingerprint_data = load_json_list(fingerprint_file)

    # 3. Combine them
    combined_output = []
    for installed_pkg in fingerprint_data:
        pkg_name = installed_pkg.get("package")
        if not pkg_name:
            continue
        
        # Find all vulnerabilities for this specific package
        vulnerabilities = cve_map.get(pkg_name, [])
        
        combined_record = {
            "package": pkg_name,
            "installed_version": installed_pkg.get("version"),
            "vulnerabilities": vulnerabilities # This is a list of all matching CVEs
        }
        combined_output.append(combined_record)

    # 4. Write the new combined file
    with open(combined_file, "w", encoding="utf8") as f:
        for item in combined_output:
            f.write(json.dumps(item, ensure_ascii=False) + "\n")

    logging.info(f"Successfully created {combined_file}")


# --- Main execution ---
if __name__ == "__main__":
    for app in APPS:
        process_app(app)
        logging.info("-" * 20)
    logging.info("All files combined.")