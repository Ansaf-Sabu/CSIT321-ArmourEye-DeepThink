"""
NOTE: This is a UTILITY SCRIPT, not part of the main application runtime.
Used for development/setup to sync Cloudflare tunnel URLs between Colab and local backend.

---

Fully automated Colab script - writes URL to file that local backend auto-reads
Run this after getting your Cloudflare URL
"""

import re
import json
import time
import requests
from pathlib import Path

print("🤖 Auto-updating ArmourEye remote URL...")
print("=" * 60)

# Wait for tunnel to initialize
time.sleep(2)

# Read tunnel log and extract URL
# Try multiple possible locations for tunnel.log
cloudflare_url = None
tunnel_log_paths = [
    'tunnel.log',  # Current directory
    '/content/tunnel.log',  # Colab root
    Path.cwd() / 'tunnel.log',  # Current working directory
]

for log_path in tunnel_log_paths:
    try:
        log_file = Path(log_path)
        if log_file.exists():
            with open(log_file, 'r') as f:
                log = f.read()
            
            url_match = re.search(r'https://[a-z0-9-]+\.trycloudflare\.com', log)
            if url_match:
                cloudflare_url = url_match.group(0)
                print(f"✅ Found URL in {log_path}")
                break
    except:
        continue

# If still not found, try to get from global variable (if running in notebook)
if not cloudflare_url:
    try:
        # Check if running in IPython/Jupyter and if cloudflare_url variable exists
        import sys
        if 'ipython' in sys.modules or 'IPython' in sys.modules:
            from IPython import get_ipython
            ipython = get_ipython()
            if ipython and 'cloudflare_url' in ipython.user_ns:
                cloudflare_url = ipython.user_ns['cloudflare_url']
                print("✅ Found URL from notebook variable")
    except:
        pass

# Last resort: ask user
if not cloudflare_url:
    print("❌ Could not find URL in tunnel.log")
    print("💡 If you ran Step 5, the URL should be in the 'cloudflare_url' variable")
    cloudflare_url = input("Enter Cloudflare URL manually (or press Enter to exit): ").strip()

if not cloudflare_url:
    print("❌ No URL provided")
    exit(1)

# Test the URL
print(f"\n🧪 Testing: {cloudflare_url}")
try:
    r = requests.get(f"{cloudflare_url}/health", timeout=10)
    if r.status_code == 200:
        print("✅ Server is accessible!")
    else:
        print(f"⚠️  Status: {r.status_code}")
except Exception as e:
    print(f"⚠️  Warning: {e}")

# Write to file that local backend will auto-read
project_root = Path('/content/drive/MyDrive/<Folder Path>/ArmourEye-main')
update_file = project_root / 'backend/data/colab-remote-url.json'

update_data = {
    "remoteUrl": cloudflare_url,
    "autoSwitchToRemote": True,  # Automatically switch to remote mode
    "updatedAt": time.strftime('%Y-%m-%dT%H:%M:%S.%fZ', time.gmtime()),
    "source": "colab-auto-update"
}

try:
    # Ensure directory exists
    update_file.parent.mkdir(parents=True, exist_ok=True)
    
    # Write the update file
    with open(update_file, 'w') as f:
        json.dump(update_data, f, indent=2)
    
    print(f"\n✅ URL written to: {update_file}")
    print(f"   Remote URL: {cloudflare_url}")
    print(f"   Auto-switch: Enabled")
    print("\n" + "=" * 60)
    print("📋 Next steps:")
    print("=" * 60)
    print("\n1. Make sure Google Drive is synced on your local machine")
    print("2. The ArmourEye backend will auto-detect and update within 5 seconds")
    print("3. Check the backend console for: '[ai-settings] Auto-updating remote URL'")
    print("\n💡 If Google Drive isn't synced, the file is at:")
    print(f"   {update_file}")
    print("=" * 60)
    
except Exception as e:
    print(f"\n❌ Failed to write update file: {e}")
    print(f"\n📋 Manual update command:")
    print(f"   node backend/ai/update_remote_url.js {cloudflare_url}")

