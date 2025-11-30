import os
import json
import glob
import logging
from tqdm import tqdm  # <-- 1. Import tqdm

# --- Config ---
# The folder with your 11 Trivy scan JSON files
FINGERPRINT_DIR = r"C:\Users\Demo_\fingerprints" 
# Where you want the new files to be saved
OUTPUT_DIR = r"C:\Users\Demo_\Downloads\armoureye\Datasets" 

# Define output filenames
FP_OUT_PATH = os.path.join(OUTPUT_DIR, "combined_fingerprints.json")
CVE_OUT_PATH = os.path.join(OUTPUT_DIR, "combined_cve_details.json")

# Setup logging
logging.basicConfig(level=logging.INFO, format="%(message)s")
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Use sets for deduplication
fingerprint_set = set()
cve_seen_set = set()
all_cves_list = []

# Find all Trivy JSON scans
scan_files = glob.glob(os.path.join(FINGERPRINT_DIR, "*.json"))
logging.info(f"Found {len(scan_files)} Trivy scan files in {FINGERPRINT_DIR}\n")

# --- 2. Wrap scan_files with tqdm ---
for file_path in tqdm(scan_files, desc="Processing scans"):
    # This log is no longer needed, tqdm handles it.
    # logging.info(f"Processing {os.path.basename(file_path)}...") 
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            scan_data = json.load(f)
    except Exception as e:
        logging.warning(f"  Could not read or parse {file_path}: {e}")
        continue

    # Trivy reports store data in a 'Results' list
    if not isinstance(scan_data.get('Results'), list):
        logging.warning(f"  Skipping {file_path}: No 'Results' list found.")
        continue
        
    total_vulns = 0
    for result in scan_data.get('Results', []):
        # Vulnerabilities are in a nested list
        if not isinstance(result.get('Vulnerabilities'), list):
            continue
            
        for vuln in result.get('Vulnerabilities', []):
            pkg_name = vuln.get('PkgName')
            pkg_version = vuln.get('InstalledVersion')
            
            # --- 1. Add to Fingerprint Set ---
            if pkg_name and pkg_version:
                fingerprint_set.add((pkg_name, pkg_version))
                
            # --- 2. Add to CVE List ---
            cve_id = vuln.get('VulnerabilityID')
            if not cve_id:
                continue # Skip if no CVE ID

            cve_key = (cve_id, pkg_name, pkg_version)

            if cve_key not in cve_seen_set:
                cve_record = {
                    "cve_id": cve_id,
                    "package": pkg_name,
                    "version": pkg_version,
                    "severity": vuln.get('Severity'),
                    "title": vuln.get('Title'),
                    "primary_url": vuln.get('PrimaryURL'),
                    "description": vuln.get('Description')
                }
                all_cves_list.append(cve_record)
                cve_seen_set.add(cve_key) # Mark as seen
                total_vulns += 1
                
    # This log is optional but good for seeing detail
    # logging.info(f"  Found {total_vulns} new vulnerabilities in {os.path.basename(file_path)}.")

# --- Write Final Files ---

fingerprint_list = [{"package": name, "version": ver} for name, ver in fingerprint_set]

fingerprint_list.sort(key=lambda x: x['package'])
all_cves_list.sort(key=lambda x: (x['package'], x['cve_id']))

try:
    with open(FP_OUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(fingerprint_list, f, indent=2)
    logging.info(f"\n✅ Successfully wrote {len(fingerprint_list)} unique fingerprints to {FP_OUT_PATH}")
except Exception as e:
    logging.error(f"  Failed to write fingerprint file: {e}")

try:
    with open(CVE_OUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(all_cves_list, f, indent=2)
    logging.info(f"✅ Successfully wrote {len(all_cves_list)} unique CVEs to {CVE_OUT_PATH}")
except Exception as e:
    logging.error(f"  Failed to write CVE file: {e}")

logging.info("\nAll files processed.")