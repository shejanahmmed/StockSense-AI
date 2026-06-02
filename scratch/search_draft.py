import glob
import os

for path in glob.glob("src/api/**/*.py", recursive=True):
    with open(path, "r", encoding="utf-8") as f:
        for i, line in enumerate(f, 1):
            if "purchase_order/draft" in line or "/draft" in line:
                print(f"{path}:{i}: {line.strip()}")
