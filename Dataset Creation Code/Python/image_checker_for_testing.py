import os
import json
import glob
import logging

# --- Config ---
# Add both directories to a list
SCAN_DIRS = [
    r"C:\Users\Demo_\fingerprints",
    r"C:\Windows\System32"
]
# Define the file patterns to look for
FILE_PATTERNS = ["*.json", "*_trivy.json"]

# Define the output file path
OUTPUT_DIR = r"C:\Users\Demo_\Downloads\armoureye\Datasets"
OUTPUT_FILE = os.path.join(OUTPUT_DIR, "image_details.json")

logging.basicConfig(level=logging.INFO, format="%(message)s")
os.makedirs(OUTPUT_DIR, exist_ok=True) # Ensure output directory exists

all_scan_files = []
for directory in SCAN_DIRS:
    for pattern in FILE_PATTERNS:
        all_scan_files.extend(glob.glob(os.path.join(directory, pattern)))

logging.info(f"Found {len(all_scan_files)} total scan files. Reading details...")

# This list will hold our results
image_details_list = []

# Loop through every file found
for file_path in all_scan_files:
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)

        # Extract the image details
        artifact_name = data.get("ArtifactName") # Get the image name
        
        # Skip if ArtifactName is missing (it's not a real scan)
        if not artifact_name:
            logging.warning(f"Skipping {os.path.basename(file_path)}: No 'ArtifactName' found.")
            continue

        metadata = data.get("Metadata", {})
        os_info = metadata.get("OS", {})
        os_family = os_info.get("Family")
        os_name = os_info.get("Name")
        
        # Add the details to our list
        image_details_list.append({
            "source_file": os.path.basename(file_path),
            "image_name": artifact_name,
            "os_family": os_family,
            "os_name": os_name
        })
        
        logging.info(f"Processed: {artifact_name}")

    except json.JSONDecodeError:
        logging.warning(f"Could not parse JSON in {file_path}. Skipping.")
    except Exception as e:
        # Catch other errors, like the 'list' object error
        logging.warning(f"An error occurred with {file_path}: {e}. Skipping.")

# --- Write the final JSON file ---
try:
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        # Dump the entire list as a single, nicely formatted JSON array
        json.dump(image_details_list, f, indent=2, ensure_ascii=False)
    
    logging.info("="*30)
    logging.info(f"✅ Successfully wrote {len(image_details_list)} image details to:")
    logging.info(OUTPUT_FILE)

except Exception as e:
    logging.error(f"FATAL: Could not write output file: {e}")