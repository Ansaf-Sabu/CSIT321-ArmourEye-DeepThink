import json

def find_unique_links(input_file, output_file):
    """
    Reads a JSONL file, finds unique objects based on 'cve_id' and 'url',
    and writes them to a new JSONL file.
    """
    unique_links = []
    seen = set()
    
    try:
        # Open the input file and read line by line
        with open(input_file, 'r', encoding='utf-8') as infile:
            for line in infile:
                # Strip whitespace and skip empty lines
                line = line.strip()
                if not line:
                    continue
                
                try:
                    # Parse the JSON object from the line
                    obj = json.loads(line)
                    
                    # Create a unique key based on CVE ID and URL
                    key = f"{obj.get('cve_id')}|{obj.get('url')}"
                    
                    # If this combination hasn't been seen, add it
                    if key not in seen:
                        seen.add(key)
                        unique_links.append(obj)
                        
                except json.JSONDecodeError:
                    print(f"Warning: Skipping malformed line: {line}")
        
        # Write the unique list to the output file in JSONL format
        with open(output_file, 'w', encoding='utf-8') as outfile:
            for item in unique_links:
                json.dump(item, outfile)
                outfile.write('\n')
                
        print(f"Success! Found {len(unique_links)} unique dead links and saved them to {output_file}")

    except FileNotFoundError:
        print(f"Error: Input file not found at {input_file}")
    except Exception as e:
        print(f"An error occurred: {e}")

if __name__ == "__main__":
    INPUT_FILE_NAME = 'C:/Users/Demo_/Downloads/armoureye/Datasets/dead_links_report.jsonl'
    OUTPUT_FILE_NAME = 'C:/Users/Demo_/Downloads/armoureye/Datasets/unique_dead_links.jsonl'
    find_unique_links(INPUT_FILE_NAME, OUTPUT_FILE_NAME)


