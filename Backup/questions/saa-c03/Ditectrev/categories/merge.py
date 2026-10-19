import json
import glob
import os

def merge_json_files_with_category(output_file="aws_saa_c03_merged.json"):
    merged_data = []
    file_list = sorted(glob.glob("*.json"))
    
    for file_name in file_list:
        if file_name == output_file:
            continue
            
        # Extract a category name from the filename (e.g., '1-secure-architectures')
        category_name = os.path.splitext(file_name)[0]
        
        with open(file_name, "r", encoding="utf-8") as f:
            try:
                data = json.load(f)
                if isinstance(data, list):
                    for item in data:
                        if isinstance(item, dict):
                            # Injects a 'category' field into each question object
                            item["category"] = category_name
                    merged_data.extend(data)
            except json.JSONDecodeError as e:
                print(f"Error reading {file_name}: {e}")
                
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(merged_data, f, indent=2, ensure_ascii=False)

if __name__ == "__main__":
    merge_json_files_with_category()