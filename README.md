# DocuSwarm

**A parallel document due-diligence agent swarm, served by vLLM on AMD Instinct GPUs (ROCm).**

Built for the [AMD Developer Hackathon: ACT III](https://lablab.ai/ai-hackathons/amd-developer-hackathon-act-iii) — *"AI agents and high-performance AI applications on AMD GPUs in the cloud."*

**Live demo (no GPU, runs in your browser):** https://yanerox69.github.io/docuswarm/

## Status

Tested end-to-end on real AMD hardware: an **AMD Instinct MI300X** GPU
Droplet on AMD Developer Cloud, serving **Qwen3-8B** through vLLM's ROCm
build. On that instance DocuSwarm processed **6 documents concurrently in
1.5 seconds at 1,653.9 tokens/sec** — real GPU throughput read from vLLM's
`usage` field, not a simulation. Each result reflects genuine LLM judgment
(for example, a contract flagged MEDIUM risk for termination penalties and
liquidated damages), not keyword matching.

The video presentation and slide deck were captured live from that
instance. The droplet was powered off once the AMD Developer Cloud trial
credit ran out, so the demo URL in the submission may no longer respond;
the video is the record of the live run.

To reproduce it on your own GPU, follow
[`deploy/AMD_DEPLOYMENT.md`](deploy/AMD_DEPLOYMENT.md). The backend talks
to any OpenAI-compatible endpoint, so it is an env var change, not a code
change. Without a GPU, the included deterministic mock provider runs the
full flow — concurrent processing, live dashboard, export.

## The problem

Reviewing a stack of contracts, NDAs, or vendor agreements for risky clauses
is slow, manual work — hours per document, done one at a time. DocuSwarm
turns that into a single upload: drop in up to 20 documents and a swarm of
agents analyzes them **concurrently** against the same LLM endpoint,
surfacing risk level, red flags, key dates, and parties per document, with
a consolidated Excel/JSON report at the end.

## Why this fits the hackathon

This isn't a chatbot demo — it's built to make GPU throughput visible:

- **Real concurrency, not a queue.** Every document gets its own async
  task; a semaphore caps how many are in flight (1x/2x/4x/8x, selectable
  in the UI). All of them hit the *same* vLLM server, which is exactly the
  continuous-batching workload AMD Instinct GPUs + ROCm + vLLM are built
  for — throughput scales with concurrency instead of documents queuing
  one behind another.
- **A live performance dashboard.** While the swarm runs, the UI streams
  (via SSE) completed/total, tokens/sec, elapsed time, and the active
  concurrency — reading vLLM's real `usage` field once pointed at a live
  GPU endpoint, so the numbers on screen are the actual GPU throughput.
- **Provider-agnostic by design.** The backend talks to any
  OpenAI-compatible `/v1/chat/completions` endpoint. Moving from a laptop
  to an AMD Developer Cloud MI300X instance is a one-line env var change
  (`LLM_BASE_URL`) — see [`deploy/AMD_DEPLOYMENT.md`](deploy/AMD_DEPLOYMENT.md).

## Architecture

```
┌─────────────┐      multipart upload       ┌──────────────────┐
│  React UI   │ ───────────────────────────▶ │  FastAPI backend │
│ (dashboard, │ ◀─────── SSE stream ──────── │  (async swarm     │
│  drag&drop) │      status + metrics        │   orchestrator)  │
└─────────────┘                              └─────────┬────────┘
                                                         │ N concurrent
                                                         │ chat requests
                                                         ▼
                                              ┌──────────────────┐
                                              │  vLLM server     │
                                              │  on AMD Instinct │
                                              │  GPU (ROCm)      │
                                              └──────────────────┘
```

- `backend/app/swarm.py` — async orchestrator: one task per document,
  bounded by an `asyncio.Semaphore`, streaming per-document status and
  aggregate throughput metrics as they happen.
- `backend/app/llm.py` — OpenAI-compatible client (sync + async) targeting
  vLLM; includes a deterministic **mock provider** so the whole app runs
  and demos without any GPU attached.
- `backend/app/documents.py` — PDF/DOCX/TXT text extraction.
- `backend/app/agent.py` — a secondary ReAct-style research agent
  (web_search / fetch_url / calculator tools) exposed at
  `POST /api/agent/run`, kept from an earlier iteration of this project as
  a bonus capability.
- `App.tsx` + `components/` — the DocuSwarm dashboard: file dropzone,
  concurrency selector, live per-document cards, throughput bar, export
  buttons.

## Quickstart (no GPU required)

The backend defaults to `LLM_PROVIDER=mock`, a deterministic stand-in that
lets you run and demo the entire flow — upload, concurrent processing,
live dashboard, export — without any model or GPU.

```bash
# backend
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8080

# frontend (new terminal, repo root)
npm install
npm run dev
```

Open http://localhost:3000, drop in a few `.txt`/`.pdf`/`.docx` files, and
hit **Analyze**.

## Running on real AMD GPUs

See [`deploy/AMD_DEPLOYMENT.md`](deploy/AMD_DEPLOYMENT.md) for the full
walkthrough: serving a model with vLLM's ROCm build, pointing the backend
at it, and running the full stack with `docker compose`.

## Performance

**Measured on AMD hardware.** On an AMD Instinct MI300X (AMD Developer Cloud)
serving Qwen3-8B through vLLM's ROCm build, DocuSwarm processed 6 documents
concurrently in 1.5 seconds at 1,653.9 tokens/sec. That run is the one shown
in the video. The instance was shut down when the trial credit ran out, so a
full concurrency sweep on the GPU is still pending.

**Concurrency sweep, mock provider.** `backend/bench.py` runs the same batch
at 1x, 2x, 4x and 8x concurrency and prints the table below. With the mock
provider each document takes a simulated 0.6–1.8 s, so this measures the
swarm orchestration only, not GPU throughput: it shows that wall time falls
as documents are dispatched in parallel instead of queuing.

16 documents (the 8 samples in `public/samples/`, twice), `python bench.py --repeat 2`:

| Concurrency | Wall time | Speed-up vs 1x | Tokens/sec | Avg latency per doc |
|---|---|---|---|---|
| 1x | 20.04 s | 1.00x | 199.9 | 1.25 s |
| 2x | 11.83 s | 1.69x | 338.7 | 1.43 s |
| 4x | 5.25 s | 3.82x | 763.6 | 1.19 s |
| 8x | 3.32 s | 6.03x | 1205.7 | 1.29 s |

**Reproduce it on a GPU.** Point the same script at a vLLM server:

```bash
cd backend
LLM_PROVIDER=vllm LLM_BASE_URL=http://<host>:8000/v1 LLM_MODEL=Qwen/Qwen3-8B python bench.py --repeat 2
```

On a real server the per-document latency is expected to stay roughly flat as
concurrency rises while tokens/sec climbs, because vLLM batches the concurrent
requests on the GPU.

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Model serving | vLLM (ROCm build) | Official high-throughput serving engine with first-class AMD Instinct GPU support |
| Backend | FastAPI + asyncio | Native async concurrency to drive many simultaneous LLM requests |
| Frontend | React + Vite + TypeScript | Fast dev loop, SSE-friendly streaming UI |
| Export | openpyxl | Consolidated Excel report for the due-diligence findings |

## Tests

```bash
cd backend && source .venv/bin/activate && pytest
```

## License

[MIT](LICENSE)
