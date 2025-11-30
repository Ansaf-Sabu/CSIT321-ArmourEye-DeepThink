from huggingface_hub import snapshot_download
import os

# --- Configuration ---
# You might need to accept terms on the HF website first for Llama 3.1
# ======> THIS LINE IS UPDATED <======
model_id = "meta-llama/Llama-3.1-8B-Instruct" 
# ====================================
local_model_path = r"C:\Users\Demo_\Downloads\armoureye\Llama" 

# --- Optional: Hugging Face Login (if required for Llama 3) ---
# Ensure you ran: huggingface-cli login in your terminal first.

# --- Download ---
print(f"Downloading model {model_id} to {local_model_path}...")

# Ensure the target directory exists
os.makedirs(local_model_path, exist_ok=True) 

snapshot_download(
    repo_id=model_id,
    local_dir=local_model_path,
    local_dir_use_symlinks=False, # Use False on Windows generally
    resume_download=True # In case connection drops
)

print(f"Model download complete in {local_model_path}")