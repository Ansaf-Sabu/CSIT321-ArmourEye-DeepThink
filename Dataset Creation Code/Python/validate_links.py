import os
import json
import logging
import requests
from tqdm import tqdm
from concurrent.futures import ThreadPoolExecutor, as_completed

# --- Config ---
DATASET_DIR = r"C:\Users\Demo_\Downloads\armoureye\Datasets"
# Input: The master file
INPUT_FILE = os.path.join(DATASET_DIR, "MASTER_package_dataset.jsonl")
# Output 1: The validated master file
OUTPUT_VALIDATED_FILE = os.path.join(DATASET_DIR, "MASTER_package_dataset_validated.jsonl")
# Output 2: File for dead/error links
OUTPUT_DEAD_LINKS_FILE = os.path.join(DATASET_DIR, "dead_links_report.jsonl")

USER_AGENT = "link-validator/1.2" # Version bump
REQUEST_TIMEOUT = 10  # Seconds
MAX_WORKERS = 10     # Parallel checks

logging.basicConfig(level=logging.INFO, format="%(message)s")

# --- Counters ---
total_links_checked = 0
links_alive = 0
links_dead = 0 # Includes timeouts now
links_error = 0

# List to collect dead/error link info
dead_link_records = []

def check_url_status(url, cve_id, link_type):
    """Checks a single URL using a HEAD request and collects dead links."""
    global total_links_checked, links_alive, links_dead, links_error
    total_links_checked += 1
    status = "unknown"
    try:
        response = requests.head(url, headers={'User-Agent': USER_AGENT}, timeout=REQUEST_TIMEOUT, allow_redirects=True)
        if 200 <= response.status_code < 400:
            links_alive += 1
            status = "alive"
        elif 400 <= response.status_code < 600:
            links_dead += 1
            status = "dead"
            dead_link_records.append({"cve_id": cve_id, "type": link_type, "url": url, "status": status})
        else:
            links_error += 1 # Treat unknown status codes as errors for reporting
            status = f"error (status {response.status_code})"
            dead_link_records.append({"cve_id": cve_id, "type": link_type, "url": url, "status": status})
        return status
    except requests.exceptions.Timeout:
        links_dead += 1
        status = "dead (timeout)"
        dead_link_records.append({"cve_id": cve_id, "type": link_type, "url": url, "status": status})
        return status
    except requests.exceptions.RequestException as e:
        links_error += 1
        status = f"error ({type(e).__name__})" # More specific error type
        dead_link_records.append({"cve_id": cve_id, "type": link_type, "url": url, "status": status})
        return status
    except Exception as e:
        links_error += 1
        status = "error (unexpected)"
        logging.warning(f"Unexpected error checking {url}: {e}")
        dead_link_records.append({"cve_id": cve_id, "type": link_type, "url": url, "status": status})
        return status

def process_package_record(package_data):
    """Processes URLs within the vulnerabilities list of a package record."""
    vulnerabilities = package_data.get("vulnerabilities", [])
    if not isinstance(vulnerabilities, list):
        return package_data

    for cve in vulnerabilities:
        if not isinstance(cve, dict): continue
        cve_id = cve.get("cve_id", "UNKNOWN_CVE") # Get CVE ID for reporting dead links

        # Process Exploits
        if "exploits" in cve and isinstance(cve["exploits"], list):
            for exploit in cve["exploits"]:
                if isinstance(exploit, dict) and "url" in exploit:
                    exploit["status"] = check_url_status(exploit["url"], cve_id, "exploit")

        # Process Fixes
        if "fixes" in cve and isinstance(cve["fixes"], list):
             for fix in cve["fixes"]:
                if isinstance(fix, dict) and "url" in fix:
                    fix["status"] = check_url_status(fix["url"], cve_id, "fix")
    return package_data

# --- Main Execution ---
if __name__ == "__main__":
    logging.info(f"Loading data from {INPUT_FILE}...")
    try:
        with open(INPUT_FILE, 'r', encoding='utf-8') as f:
            lines = f.readlines()
        all_records = [json.loads(line) for line in lines if line.strip()]
    except FileNotFoundError:
        logging.error(f"FATAL: Input file not found: {INPUT_FILE}")
        exit()
    except Exception as e:
        logging.error(f"FATAL: Failed to load or parse input file: {e}")
        exit()

    logging.info(f"Loaded {len(all_records)} package records. Starting URL validation...")

    validated_records = []

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futs = {executor.submit(process_package_record, record): record for record in all_records}
        for future in tqdm(as_completed(futs), total=len(all_records), desc="Validating URLs"):
            try:
                result = future.result()
                if result:
                    validated_records.append(result)
            except Exception as e:
                logging.error(f"Error processing a record: {e}")

    logging.info(f"Validation complete.")

    # --- Write Validated Master File ---
    try:
        logging.info(f"Writing {len(validated_records)} records to {OUTPUT_VALIDATED_FILE}...")
        with open(OUTPUT_VALIDATED_FILE, 'w', encoding='utf-8') as f:
            for entry in validated_records:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        logging.info(f"✅ Successfully wrote validated data to {OUTPUT_VALIDATED_FILE}")
    except Exception as e:
        logging.error(f"Failed to write validated master file: {e}")

    # --- Write Dead Links Report File ---
    try:
        logging.info(f"Writing {len(dead_link_records)} dead/error links to {OUTPUT_DEAD_LINKS_FILE}...")
        with open(OUTPUT_DEAD_LINKS_FILE, 'w', encoding='utf-8') as f:
            for record in dead_link_records:
                f.write(json.dumps(record, ensure_ascii=False) + "\n")
        logging.info(f"✅ Successfully wrote dead links report to {OUTPUT_DEAD_LINKS_FILE}")
    except Exception as e:
        logging.error(f"Failed to write dead links report file: {e}")


    # --- Print Summary ---
    logging.info("\n--- URL VALIDATION SUMMARY ---")
    logging.info(f"Total Links Checked: {total_links_checked}")
    logging.info(f"Links Alive (2xx/3xx): {links_alive}")
    logging.info(f"Links Dead (4xx/5xx/Timeout): {links_dead}")
    logging.info(f"Links with Errors (Connection/SSL/Unknown Status/etc.): {links_error}")

    logging.info("\nAll done.")