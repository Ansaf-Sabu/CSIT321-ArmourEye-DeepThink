import os
import json
import logging
from tqdm import tqdm

# --- Config ---
DATASET_DIR = r"C:\Users\Demo_\Downloads\armoureye\Datasets"

# 1. Input: The file with all unique packages
FINGERPRINT_FILE = os.path.join(DATASET_DIR, "combined_fingerprints_webapp.json")

# 2. Input: The file with all CVEs + exploit/fix links
CVE_FILE = os.path.join(DATASET_DIR, "final_enriched_dataset_webapp.jsonl")

# 3. Output: The new file combining both
OUTPUT_FILE = os.path.join(DATASET_DIR, "package_centric_dataset.jsonl")

logging.basicConfig(level=logging.INFO, format="%(message)s")

# --- 1. Load the Enriched CVEs into a Lookup Map ---
logging.info(f"Loading enriched CVEs from {CVE_FILE}...")
cve_map = {}
try:
    with open(CVE_FILE, 'r', encoding='utf-8') as f:
        for line in tqdm(f, desc="Loading CVEs"):
            if not line.strip():
                continue
            
            try:
                cve_data = json.loads(line)
                pkg_name = cve_data.get("package")
                
                if not pkg_name:
                    continue
                
                # Add this CVE to the list for its package
                if pkg_name not in cve_map:
                    cve_map[pkg_name] = []
                cve_map[pkg_name].append(cve_data)
                
            except json.JSONDecodeError:
                logging.warning(f"Skipping bad JSON line: {line[:50]}...")

except FileNotFoundError:
    logging.error(f"FATAL: CVE input file not found at {CVE_FILE}")
    exit()

logging.info(f"Loaded {len(cve_map)} packages with CVEs into memory.")

# --- 2. Load Fingerprints and Combine ---
logging.info(f"Loading fingerprints from {FINGERPRINT_FILE}...")
try:
    with open(FINGERPRINT_FILE, 'r', encoding='utf-8') as f:
        fingerprint_list = json.load(f)
except FileNotFoundError:
    logging.error(f"FATAL: Fingerprint input file not found at {FINGERPRINT_FILE}")
    exit()
except Exception as e:
    logging.error(f"FATAL: Could not parse {FINGERPRINT_FILE}: {e}")
    exit()

logging.info(f"Processing {len(fingerprint_list)} packages from fingerprint...")

# --- 3. Write the Final Combined File ---
total_matched = 0
try:
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        for package_info in tqdm(fingerprint_list, desc="Combining data"):
            pkg_name = package_info.get("package")
            if not pkg_name:
                continue
            
            # Find all vulnerabilities for this package
            # .get(pkg_name, []) returns an empty list if the package has no CVEs
            vulnerabilities = cve_map.get(pkg_name, [])
            
            if vulnerabilities:
                total_matched += 1
            
            # Create the new combined record
            combined_record = {
                "package": pkg_name,
                "installed_version": package_info.get("version"),
                "vulnerabilities": vulnerabilities  # This is the list of CVEs
            }
            
            # Write this record as a new line in the .jsonl file
            f.write(json.dumps(combined_record, ensure_ascii=False) + "\n")

    logging.info("\n--- SUMMARY ---")
    logging.info(f"Successfully wrote {len(fingerprint_list)} records to {OUTPUT_FILE}")
    logging.info(f"({total_matched} of those packages had vulnerabilities).")

except Exception as e:
    logging.error(f"An error occurred while writing the file: {e}")