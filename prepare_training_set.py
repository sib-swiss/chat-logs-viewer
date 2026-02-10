import argparse
import json
from pathlib import Path

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


def build_training_dataset(in_file: Path, out_file: Path) -> None:
    """Build training dataset from merged log file, extract SPARQL queries with successful results."""
    out_file.parent.mkdir(parents=True, exist_ok=True)

    with out_file.open("w", encoding="utf-8") as out:
        print(f"📂 Processing {in_file}")
        seen: set[tuple[str, str]] = set()
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
                            key = (qres.question.strip(), qres.sparql_query.strip())
                            if key in seen:
                                continue
                            seen.add(key)
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
    print(f"✅ Training dataset saved to {out_file}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Build training dataset from merged log file, extract SPARQL queries with successful results."
    )
    parser.add_argument(
        "input",
        nargs="?",
        default="data/langfuse.jsonl",
        help="Path to the input merged log file (default: data/langfuse.jsonl)",
    )
    parser.add_argument(
        "-o",
        "--out",
        dest="output",
        default="data/train_sparql.jsonl",
        help="Path to the output jsonl file (default: data/train_sparql.jsonl)",
    )
    args = parser.parse_args()

    build_training_dataset(in_file=Path(args.input), out_file=Path(args.output))
