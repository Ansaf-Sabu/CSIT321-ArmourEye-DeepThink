import os
import json
import logging
import subprocess

# --- Config ---
DATASET_DIR = r"C:\Users\Demo_\Downloads\armoureye\Datasets"
INPUT_FILE = os.path.join(DATASET_DIR, "image_details.json")

# Setup logging
logging.basicConfig(level=logging.INFO, format="%(message)s")

# --- 1. Load and Deduplicate Image Names ---
logging.info(f"Loading image list from {INPUT_FILE}...")
try:
    with open(INPUT_FILE, 'r', encoding='utf-8') as f:
        image_data = json.load(f)
    
    # Use a set to automatically get only unique image names
    image_names = {item.get("image_name") for item in image_data if item.get("image_name")}
    
    if not image_names:
        logging.error("No image names found in the JSON file.")
        exit()

except FileNotFoundError:
    logging.error(f"FATAL: File not found: {INPUT_FILE}")
    exit()
except Exception as e:
    logging.error(f"FATAL: Could not read file: {e}")
    exit()

logging.info(f"Found {len(image_names)} unique images to download.")
logging.info("="*30)

# --- 2. Loop and Pull Each Image ---
successful_pulls = 0
failed_pulls = []

for image_name in sorted(image_names):
    logging.info(f"\nAttempting to pull: {image_name}")
    
    # Create the command
    command = ["docker", "pull", image_name]
    
    try:
        # Run the command. This will print Docker's output (like "Pulling...")
        # directly to your terminal.
        result = subprocess.run(command, check=True, text=True)
        
        # check=True will raise an error if the command fails
        logging.info(f"✅ Successfully pulled: {image_name}")
        successful_pulls += 1
        
    except FileNotFoundError:
        logging.error("FATAL: 'docker' command not found.")
        logging.error("Please ensure Docker Desktop is installed and running.")
        exit()
    except subprocess.CalledProcessError as e:
        # This catches errors from Docker (e.g., "image not found")
        logging.warning(f"⚠️ FAILED to pull: {image_name}. Docker said: {e.stderr}")
        failed_pulls.append(image_name)
    except Exception as e:
        logging.error(f"An unexpected error occurred for {image_name}: {e}")
        failed_pulls.append(image_name)

# --- Final Summary ---
logging.info("\n" + "="*30)
logging.info("DOWNLOAD COMPLETE")
logging.info(f"Successfully pulled: {successful_pulls}")
logging.info(f"Failed to pull:    {len(failed_pulls)}")
if failed_pulls:
    logging.warning(f"Failed images: {', '.join(failed_pulls)}")