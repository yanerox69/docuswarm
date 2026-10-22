"""Concurrency benchmark for the document swarm.

Runs the same batch of documents through analyze_swarm() at several
concurrency levels and prints a Markdown table. It uses whatever provider
the environment selects, so the same command measures the mock provider on
a laptop or a real vLLM server on an AMD Instinct GPU:

    # mock provider (no GPU, simulated latency)
    python bench.py

    # real model, e.g. vLLM on an MI300X
    LLM_PROVIDER=vllm LLM_BASE_URL=http://<host>:8000/v1 LLM_MODEL=Qwen/Qwen3-8B python bench.py
"""
import argparse
import asyncio
import random
import statistics
import time
from pathlib import Path

from app.config import settings
from app.swarm import DocInput, analyze_swarm

SAMPLES = Path(__file__).resolve().parent.parent / "public" / "samples"


async def run_once(docs, concurrency):
    start = time.monotonic()
    latencies, tokens_per_s, errors = [], 0.0, 0
    async for event in analyze_swarm(docs, concurrency=concurrency):
        if event.status == "done":
            latencies.append(event.latency_s)
            tokens_per_s = event.metrics.tokens_per_s
        elif event.status == "error":
            errors += 1
    return {
        "wall_s": time.monotonic() - start,
        "tokens_per_s": tokens_per_s,
        "latency_s": statistics.mean(latencies) if latencies else 0.0,
        "errors": errors,
    }


async def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--levels", default="1,2,4,8", help="comma-separated concurrency levels")
    parser.add_argument("--repeat", type=int, default=1, help="copies of the sample set per run")
    parser.add_argument("--seed", type=int, default=0, help="seed for the mock provider's latency")
    args = parser.parse_args()

    random.seed(args.seed)
    texts = [(p.name, p.read_text()) for p in sorted(SAMPLES.glob("*.txt"))]
    docs = [
        DocInput(id=f"doc-{i}", name=name, text=text)
        for i, (name, text) in enumerate(texts * args.repeat)
    ]
    levels = [int(x) for x in args.levels.split(",")]

    model = "" if settings.llm_provider == "mock" else f"  Model: {settings.llm_model}"
    print(f"Provider: {settings.llm_provider}{model}  Documents: {len(docs)}\n")
    print("| Concurrency | Wall time | Speed-up vs 1x | Tokens/sec | Avg latency per doc | Errors |")
    print("|---|---|---|---|---|---|")
    baseline = None
    for level in levels:
        r = await run_once(docs, level)
        baseline = baseline or r["wall_s"]
        print(
            f"| {level}x | {r['wall_s']:.2f} s | {baseline / r['wall_s']:.2f}x | "
            f"{r['tokens_per_s']:.1f} | {r['latency_s']:.2f} s | {r['errors']} |"
        )


if __name__ == "__main__":
    asyncio.run(main())
