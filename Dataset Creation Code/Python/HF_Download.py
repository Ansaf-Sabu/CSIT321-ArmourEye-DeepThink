from huggingface_hub import snapshot_download, login
import os

# 1️⃣ Paste your Hugging Face token here
# Get your token from: https://huggingface.co/settings/tokens
hf_token = "YOUR_HUGGINGFACE_TOKEN_HERE"  # Replace with your actual token

# 2️⃣ Login
login(token=hf_token)

# 3️⃣ Set clean save directory
save_dir = r"C:\Users\Demo_\Downloads\TESTING\mistral"
os.makedirs(save_dir, exist_ok=True)

# 4️⃣ Download the model without extra cache
model_name = "mistralai/Mistral-7B-Instruct-v0.3"
snapshot_download(
    repo_id=model_name,
    local_dir=save_dir,
    local_dir_use_symlinks=False,  # makes real copies, avoids cache symlinks
    token=hf_token
)

print(f"✅ Model downloaded clean to: {save_dir}")

