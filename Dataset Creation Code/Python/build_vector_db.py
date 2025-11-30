import os
import json
import logging
from tqdm import tqdm
from langchain_community.vectorstores import Chroma
from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain.docstore.document import Document

# Setup basic logging
logging.basicConfig(level=logging.INFO, format="%(message)s")

# --- 1. Define Paths ---
BASE_DRIVE_PATH = "/content/drive/MyDrive/armoureye"
DATASET_DIR = os.path.join(BASE_DRIVE_PATH, "Dataset") # Use singular 'Dataset'
INPUT_FILE = os.path.join(DATASET_DIR, "MASTER_package_dataset_validated.jsonl")
# *** We will create a NEW, corrected database ***
CHROMA_DB_PATH_V2 = os.path.join(BASE_DRIVE_PATH, "Databases", "chroma_db_v2")

# --- 2. Load the Dataset ---
logging.info(f"Loading data from {INPUT_FILE}...")
all_package_data = []
try:
    with open(INPUT_FILE, 'r', encoding='utf-8') as f:
        for line in f:
            if line.strip():
                all_package_data.append(json.loads(line))
    logging.info(f"Loaded {len(all_package_data)} package records.")
except Exception as e:
    logging.error(f"Failed to load dataset: {e}")
    raise e

# --- 3. Prepare Data for Embedding (CORRECTED LOGIC) ---
documents_to_embed = []
logging.info("Preparing documents for embedding (with clean package handling)...")

for package_record in tqdm(all_package_data, desc="Preparing Data"):
    pkg_name = package_record.get("package")
    pkg_version = package_record.get("installed_version")
    vulnerabilities = package_record.get("vulnerabilities", [])

    if not pkg_name or not pkg_version:
        continue

    if vulnerabilities:
        # --- This package is VULNERABLE ---
        # Add one document for each vulnerability
        for vuln in vulnerabilities:
            cve_id = vuln.get("cve_id", "N/A")
            description = vuln.get("description", "No description available.")
            severity = vuln.get("severity", "UNKNOWN")

            content = f"Package: {pkg_name}\nVersion: {pkg_version}\nCVE: {cve_id}\nSeverity: {severity}\nDescription: {description}"
            metadata = {
                "package_name": pkg_name,
                "package_version": pkg_version,
                "cve_id": cve_id,
                "severity": severity,
                "cvss": vuln.get("cvss"),
                "description": description,
                "exploits_json": json.dumps(vuln.get("exploits", [])),
                "fixes_json": json.dumps(vuln.get("fixes", []))
            }
            doc = Document(page_content=content, metadata=metadata)
            documents_to_embed.append(doc)
    else:
        # --- THIS IS THE FIX ---
        # This package is CLEAN, add one entry for it
        content = f"Package: {pkg_name}\nVersion: {pkg_version}\nStatus: CLEAN"
        metadata = {
            "package_name": pkg_name,
            "package_version": pkg_version,
            "cve_id": "N/A",
            "severity": "NONE",
            "description": "No vulnerabilities found for this package in the dataset.",
            "exploits_json": "[]",
            "fixes_json": "[]"
        }
        doc = Document(page_content=content, metadata=metadata)
        documents_to_embed.append(doc)
        # --- END FIX ---

logging.info(f"Prepared {len(documents_to_embed)} total documents (including clean packages).")

# --- 4. Initialize Embedding Model ---
logging.info("Initializing embedding model (all-MiniLM-L6-v2)...")
embedding_model_name = "sentence-transformers/all-MiniLM-L6-v2"
model_kwargs = {'device': 'cuda'} # Use the L4 GPU
embeddings = HuggingFaceEmbeddings(model_name=embedding_model_name, model_kwargs=model_kwargs)

# --- 5. Create and Persist NEW ChromaDB Vector Store ---
logging.info(f"Creating NEW vector store at {CHROMA_DB_PATH_V2}...")
os.makedirs(CHROMA_DB_PATH_V2, exist_ok=True) # Ensure the directory exists

vectorstore_v2 = Chroma.from_documents(
    documents=documents_to_embed,
    embedding=embeddings,
    persist_directory=CHROMA_DB_PATH_V2 # Save the NEW DB
)

logging.info(f"New vector store created and saved to {CHROMA_DB_PATH_V2}.")
print("\n--- Setup Complete ---")
print("Your NEW vector database (v2) is ready.")