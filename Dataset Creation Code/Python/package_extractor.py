import os
import json

# Input and output paths
INPUT_DIR = r"C:\Users\Demo_\Downloads\armoureye\Datasets\All Trivy Scans"
OUTPUT_DIR = r"C:\Users\Demo_\Downloads\armoureye\Datasets\WebApp"

os.makedirs(OUTPUT_DIR, exist_ok=True)

def extract_packages(trivy_json):
    """Extract unique (package, version) pairs from Trivy JSON scan."""
    unique = set()
    results = []

    if "Results" not in trivy_json:
        return results

    for result in trivy_json["Results"]:
        # Newer Trivy structure
        if "Packages" in result:
            for pkg in result["Packages"]:
                name = pkg.get("Name")
                version = pkg.get("Version")
                if name and version:
                    key = (name, version)
                    if key not in unique:
                        unique.add(key)
                        results.append({"package": name, "version": version})

        # Older Trivy structure via vulnerabilities
        if "Vulnerabilities" in result:
            for vuln in result["Vulnerabilities"]:
                name = vuln.get("PkgName")
                version = vuln.get("InstalledVersion")
                if name and version:
                    key = (name, version)
                    if key not in unique:
                        unique.add(key)
                        results.append({"package": name, "version": version})

    return results


# Process all fingerprint files
for filename in os.listdir(INPUT_DIR):
    if "_fingerprint" not in filename:
        continue

    filepath = os.path.join(INPUT_DIR, filename)
    webapp_name = filename.split("_fingerprint")[0]

    try:
        with open(filepath, "r", encoding="utf-8") as f:
            data = json.load(f)
    except:
        print(f"Skipping non-JSON or unreadable file: {filename}")
        continue

    packages = extract_packages(data)

    out_file = os.path.join(
        OUTPUT_DIR,
        f"{webapp_name}_package_details.json"
    )

    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(packages, f, indent=2)

    print(f"Created: {out_file}")

print("Done.")
