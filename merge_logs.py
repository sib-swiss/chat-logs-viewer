# Later todo: skip entries where only 1 user message (and 1 response from AI) in output.messages and the first message content is one of the example_questions

import json
from pathlib import Path
import re
import time
from datetime import datetime

from pydantic import BaseModel
from sparql_llm.validate_sparql import extract_sparql_queries
from sparql_llm.utils import query_sparql


example_questions = [
	"Which SIB resources are supported by ExpasyGPT? ",
	"Where is the ACE2 gene expressed in humans?",
	"List primate genes expressed in the fruit fly eye",
	"What are the rat orthologs of the human HBB gene?",
	"What are the rat orthologs of the human TP53 gene?",
	"What is the HGNC symbol for the P68871 protein?",
	"Anatomical entities where the INS zebrafish gene is expressed and their gene GO annotations",
]

class QueryResults(BaseModel):
	question: str
	sparql_query: str
	sparql_endpoint: str
	results: list[dict]
	error: str | None = None


# Redirect
map_to_new_endpoints = {
	"https://biosoda.unil.ch/graphdb/repositories/emi-dbgi": "https://kg.earthmetabolome.org/metrin/api/",
}

def extract_and_exec_sparql(question: str, ai_message: str) -> QueryResults | None:
	extracted_queries = extract_sparql_queries(ai_message)
	# If multiple queries were extracted, use the last one (assumed most relevant/final)
	if not extracted_queries:
		return None
	eq = extracted_queries[-1]
	# Execute the query against the endpoint (use last extracted)
	query = eq.get("query")
	endpoint = eq.get("endpoint_url")
	# If an endpoint is present in map_to_new_endpoints, remap it to the new URL
	if query and endpoint:
		if endpoint in map_to_new_endpoints:
			endpoint = map_to_new_endpoints[endpoint]
		error_msg = None
		query_res = []
		# Ensure the query has a LIMIT clause, if not append LIMIT 50
		query_to_run = query
		if not re.search(r'\blimit\s+\d+\s*;?\s*$', query.strip(), flags=re.IGNORECASE):
			stripped = query.rstrip()
			if stripped.endswith(';'):
				stripped = stripped[:-1]
			query_to_run = stripped + '\nLIMIT 50'

		try:
			# print(f'🔍 Executing SPARQL query against endpoint {endpoint}:\n{query_to_run}')
			resp = query_sparql(query_to_run, endpoint, timeout=60, post=True)
			# TODO: handle construct queries
			query_res = resp.get("results", {}).get("bindings", [])
		except Exception as e:
			error_msg = str(e)

		return QueryResults(
			question=question,
			sparql_query=query_to_run,
			sparql_endpoint=endpoint,
			results=query_res,
			error=error_msg,
		)
	return None


def merge_logs(in_dir='data/logs', out_path='data/langfuse.jsonl') -> "dict[str, int]":
	"""Merge all JSONL files in `in_path` into `out_path`, deduplicating by `timestamp`.

	Writes each unique line immediately when a new timestamp is seen.
	Returns (input_lines, unique_written).
	"""
	out_file = Path(out_path)
	files = sorted(Path(in_dir).glob('*.jsonl'))
	seen = set()
	counts = {
		'total': 0,
		'no_output': 0,
		'unique': 0,
		'example_only': 0,
		"msgs_with_results": 0,
		"msgs_no_results": 0,
		"example_msgs": 0,
	}

	out_file.parent.mkdir(parents=True, exist_ok=True)
	with out_file.open('w', encoding='utf-8') as out:
		for f in files:
			print(f'📂 Processing file: {f}')
			try:
				with f.open('r', encoding='utf-8') as fh:
					for line in fh:
						line = line.strip()
						if not line:
							continue
						counts['total'] += 1
						if counts['total'] % 100 == 0:
							print(f"✅ Processed {counts['total']} conversations")
						try:
							obj = json.loads(line)
						except Exception:
							continue
						# Skip trivial example entries: where output.messages has exactly 2 messages (one example question and the AI response)
						try:
							# Some log lines store `input` and `output` as a JSON-encoded string. Parse it into an object
							if isinstance(obj.get('input'), str):
								try:
									obj['input'] = json.loads(obj.get('input'))
								except Exception:
									print(f"⚠️ Failed to parse 'input' JSON string: {line}")
									continue

							out_field = obj.get('output', {})
							if isinstance(out_field, str):
								try:
									out_field = json.loads(out_field)
									obj['output'] = out_field
								except Exception:
									print(f"⚠️ Failed to parse 'output' JSON string: {line}")
									continue
							if out_field is None:
								counts['no_output'] += 1
								# print(f'⚠️ No output field: {line}')
								continue
							msgs = out_field.get('messages', [])
							if len(msgs) == 0:
								counts['no_output'] += 1
								# print(f'⚠️ No messages: {line}')
								continue
							if len(msgs) == 2 and msgs[0].get("content", "").strip() in example_questions:
								counts['example_only'] += 1
								continue

							# TODO: some conversations have "output":"ValueError: EOF while parsing a value at line 2 column 0"
							# But we can extract the conversation from "input" (list of tuples ["user|assistant", "message"])

							# Iterates messages, if msg from `ai`, try to extract SPARQL query, execute it
							question: str = ""
							for msg in msgs:
								if msg.get('type') == 'human':
									# Store the natural language question
									question = msg.get('content', '').strip()
									if question in example_questions:
										counts["example_msgs"] += 1
								# print(msg)
								if msg.get('type') == 'ai':
									try:
										query_results = extract_and_exec_sparql(question, msg.get('content', ''))
										if query_results:
											if len(query_results.results) >= 0:
												counts["msgs_with_results"] += 1
											else:
												counts["msgs_no_results"] += 1
											# print(f'✅ Extracted and executed SPARQL for question: {question}')
											msg['query_results'] = query_results.model_dump()
										else:
											counts["msgs_no_results"] += 1
									except Exception as e:
										print(f'⚠️ Failed to extract/execute SPARQL: {e} - {line}')
										# continue
						except Exception as e:
							print(f'⚠️ ❌ {e} - {line}')
							continue
						ts = obj.get('timestamp')
						if not ts:
							continue
						if ts in seen:
							continue
						out.write(json.dumps(obj, ensure_ascii=False) + '\n')
						seen.add(ts)
						counts['unique'] += 1
			except FileNotFoundError:
				continue

	return counts


if __name__ == '__main__':
	start_time = time.time()

	counts = merge_logs()
	print(f'Input lines: {counts["total"]}')
	print(f'Unique timestamps written: {counts["unique"]}')
	print(f'Example only entries skipped: {counts["example_only"]}')
	print(f'No output field entries skipped: {counts["no_output"]}')
	print(f'Messages with SPARQL results: {counts["msgs_with_results"]}')
	print(f'Messages with no SPARQL results: {counts["msgs_no_results"]}')
	print(f'Example messages not skipped: {counts["example_msgs"]}')

	# Compute and print elapsed runtime in hours/min
	elapsed = time.time() - start_time
	hours = int(elapsed // 3600)
	minutes = int((elapsed % 3600) // 60)
	seconds = int(elapsed % 60)
	print(f'Runtime: {hours}h {minutes}m ({seconds}s) — {elapsed/60:.2f} minutes')
	print('Output file: data/langfuse.jsonl')
