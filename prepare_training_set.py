import json
from pathlib import Path
import time

from pydantic import BaseModel

# This script will read a merged log file, extract SPARQL queries with successful results
# https://huggingface.co/docs/trl/main/grpo_trainer

# Use it:
# from datasets import load_dataset
# ds = load_dataset("json", data_files="train_sparql.jsonl", split="train")


class QueryResults(BaseModel):
    question: str
    sparql_query: str
    sparql_endpoint: str
    results: list[dict]
    error: str | None = None


def build_training_dataset(
    in_file="data/langfuse.jsonl", out_file="data/train_sparql.jsonl"
) -> None:
    """Build training dataset from merged log file, extract SPARQL queries with successful results."""
    out_file = Path(out_file)
    in_file = Path(in_file)

    out_file.parent.mkdir(parents=True, exist_ok=True)

    with out_file.open("w", encoding="utf-8") as out:
        print(f"📂 Processing file: {in_file}")
        with in_file.open("r", encoding="utf-8") as fh:
            # Read all lines and reverse them to process newest entries first
            lines = fh.readlines()
            for line in lines:
                obj = json.loads(line)

                msgs = obj.get("output", {}).get("messages", [])
                for msg in msgs:
                    if msg.get("query_results"):
                        qres = QueryResults.model_validate(msg["query_results"])
                        if len(qres.results) > 0:
                            out.write(
                                json.dumps(
                                    {
                                        "prompt": [
                                            {"content": qres.question, "role": "user"}
                                        ],
                                        "solution": qres.sparql_query,
                                    },
                                    ensure_ascii=False,
                                )
                                + "\n"
                            )


if __name__ == "__main__":
    start_time = time.time()

    build_training_dataset()

    # Compute and print elapsed runtime in hours/min
    elapsed = time.time() - start_time
    hours = int(elapsed // 3600)
    minutes = int((elapsed % 3600) // 60)
    seconds = int(elapsed % 60)
    print(f"Runtime: {hours}h {minutes}m ({seconds}s) — {elapsed / 60:.2f} minutes")
