import os
import json
import logging
from tqdm import tqdm

# --- Config ---
DATASET_DIR = r"C:\Users\Demo_\Downloads\armoureye\Datasets"

# 1. List of all the files you want to combine
INPUT_FILES = [
    os.path.join(DATASET_DIR, "dvwa_combined.jsonl"),
    os.path.join(DATASET_DIR, "metasploitable_combined.jsonl"),
    os.path.join(DATASET_DIR, "juice_combined.jsonl"),
    # This is the 'package_centric_dataset.jsonl' you renamed
    os.path.join(DATASET_DIR, "webapp_combined.jsonl") 
]

# 2. The new master file
OUTPUT_FILE = os.path.join(DATASET_DIR, "MASTER_package_dataset.jsonl")

logging.basicConfig(level=logging.INFO, format="%(message)s")

# --- Counters ---
total_cves = 0
total_packages = 0
packages_with_exploits = 0
packages_with_fixes = 0

# Set to track duplicates: (package_name, version)
seen_packages = set()

logging.info(f"Creating master dataset at: {OUTPUT_FILE}")

with open(OUTPUT_FILE, 'w', encoding='utf-8') as f_out:
    for file_path in INPUT_FILES:
        if not os.path.isfile(file_path):
            logging.warning(f"Warning: File not found, skipping: {file_path}")
            continue
        
        logging.info(f"Processing {os.path.basename(file_path)}...")
        with open(file_path, 'r', encoding='utf-8') as f_in:
            for line in tqdm(f_in, desc=f"Reading {os.path.basename(file_path)}"):
                if not line.strip():
                    continue
                
                try:
                    data = json.loads(line)
                    pkg_name = data.get("package")
                    pkg_version = data.get("installed_version")
                    
                    # Create a unique key for this package/version
                    pkg_key = (pkg_name, pkg_version)
                    
                    # --- Check for Duplicates ---
                    if pkg_key in seen_packages:
                        continue  # Skip if we've already added this exact package
                    
                    # --- Add New Package ---
                    seen_packages.add(pkg_key)
                    f_out.write(line)  # Write the original line to the master file
                    total_packages += 1
                    
                    # --- Count CVEs and Features ---
                    vulnerabilities = data.get("vulnerabilities", [])
                    total_cves += len(vulnerabilities)
                    
                    # Check if any CVE in this package has an exploit
                    if any(cve.get("exploits") for cve in vulnerabilities):
                        packages_with_exploits += 1
                    
                    # Check if any CVE in this package has a fix
                    if any(cve.get("fixes") for cve in vulnerabilities):
                        packages_with_fixes += 1
                        
                except json.JSONDecodeError:
                    logging.warning(f"Skipping bad JSON line in {file_path}")

# --- Final Summary ---
logging.info("\n--- MASTER DATASET SUMMARY ---")
logging.info(f"Total Unique Packages:     {total_packages}")
logging.info(f"Total CVE Records Found:   {total_cves}")
logging.info(f"Packages w/ Exploit Links: {packages_with_exploits}")
logging.info(f"Packages w/ Fix Links:     {packages_with_fixes}")
logging.info(f"\n✅ Master dataset created: {OUTPUT_FILE}")