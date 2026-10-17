import json
import random

def shuffle_json_questions(file_path, output_path):
    with open(file_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    prefix_map = {0: "A. ", 1: "B. ", 2: "C. ", 3: "D. "}

    for item in data:
        original_options = item.get("options", [])
        original_correct_indices = item.get("correct", [])

        # Strip existing "A. ", "B. ", "C. ", "D. " prefixes
        cleaned_options = []
        for opt in original_options:
            if len(opt) > 3 and opt[0] in "ABCD" and opt[1:3] == ". ":
                cleaned_options.append(opt[3:])
            else:
                cleaned_options.append(opt)

        # Pair options with their original indices to track correct answers
        indexed_options = list(enumerate(cleaned_options))
        
        # Randomly shuffle options
        random.shuffle(indexed_options)

        # Reconstruct new options list and find new correct index
        new_options = []
        new_correct_indices = []

        for new_idx, (old_idx, text) in enumerate(indexed_options):
            new_options.append(f"{prefix_map[new_idx]}{text}")
            if old_idx in original_correct_indices:
                new_correct_indices.append(new_idx)

        # Update JSON object
        item["options"] = new_options
        item["correct"] = sorted(new_correct_indices)

    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

# Example execution:
#shuffle_json_questions('saa_c03_1000_questions_detailed.json', 'saa_c03_1000_questions_detailed_shuffled.json')
shuffle_json_questions('saa_c03_1000_questions_simple.json', 'saa_c03_1000_questions_simple_shuffled.json')
