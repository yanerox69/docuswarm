# Deploying DocuSwarm on AMD Developer Cloud

DocuSwarm's only AMD-specific piece is the model server: vLLM speaks the
same OpenAI-compatible API whether it's running on a laptop CPU or an
MI300X, so the backend and frontend never change — only `LLM_BASE_URL`
does.

## 0. Get access to a GPU instance

1. Join the **AMD Developer Program** (the hackathon requires this — the
   sign-up link is on the [ACT III hackathon page](https://lablab.ai/ai-hackathons/amd-developer-hackathon-act-iii)).
   Hackathon participants typically get free/discounted GPU credits; check
   the hackathon page or your welcome email for a credit/coupon code.
2. From the AMD Developer Program dashboard, find **AMD Developer Cloud**
   and launch a new GPU instance (MI300X or MI250), choosing a ROCm-preinstalled
   image if offered. Upload/select an SSH key during creation.
3. Once it's running, note its public IP and SSH in:
   ```bash
   ssh <user>@<instance-ip>
   ```
4. Install Docker if it isn't already there (most ROCm images ship with it):
   ```bash
   docker --version || curl -fsSL https://get.docker.com | sh
   ```
5. Clone this repo on the instance:
   ```bash
   git clone https://github.com/yanerox69/docuswarm.git
   cd docuswarm
   ```

## 1. Confirm the GPU is visible

```bash
rocm-smi
```

If this errors, the instance's ROCm driver isn't set up correctly — check
the instance's documentation/image before continuing; nothing below will
work without it.

## 2. Serve a model with vLLM (ROCm build)

```bash
docker build -t docuswarm-vllm -f deploy/Dockerfile.vllm-rocm \
  --build-arg MODEL=meta-llama/Llama-3.1-8B-Instruct .

docker run -d --name vllm \
  --device=/dev/kfd --device=/dev/dri --group-add video \
  --security-opt seccomp=unconfined \
  -p 8000:8000 docuswarm-vllm
```

Swap `MODEL` for any model vLLM supports (Llama, Qwen, Mixtral, ...) —
bigger models simply need more VRAM, which is where MI300X's 192GB
shines for serving larger models than commodity GPUs can hold.

## 3. Point the backend at it

```bash
cd backend
cp .env.example .env
# edit .env:
#   LLM_PROVIDER=vllm
#   LLM_BASE_URL=http://<instance-ip>:8000/v1
#   LLM_MODEL=meta-llama/Llama-3.1-8B-Instruct

pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8080
```

## 4. Serve the frontend

```bash
npm install
npm run build
# serve dist/ with any static host, or:
npm run preview -- --host 0.0.0.0
```

## 5. Or run the whole stack at once

```bash
docker compose -f deploy/docker-compose.yml up --build
```

## Option B: Fireworks AI (no GPU instance to manage, no credit card)

If you can't get an AMD Developer Cloud droplet approved (it requires a
verified payment method even with free credits), you can still run
DocuSwarm on real AMD hardware without provisioning anything yourself:
[Fireworks AI](https://fireworks.ai) has a multi-year partnership with AMD
and serves inference on AMD Instinct GPUs, exposed through the same
OpenAI-compatible `/v1/chat/completions` API our backend already targets —
so no code changes are needed, only env vars.

1. Log in to the [AMD AI Developer Program](https://www.amd.com/en/developer/ai-dev-program.html)
   portal → **Member Perks** → **Request Cloud Credits**.
2. Fill the form (affiliation, intended use, a public profile link like
   your GitHub). This issues **$50 in Fireworks AI credits, no credit card
   required** — approval takes 2-3 business days, then AMD emails a coupon
   code.
3. Go to [fireworks.ai](https://fireworks.ai), create an account, redeem
   the coupon code, and generate an API key from your Fireworks dashboard.
4. Set these in `backend/.env` (see `Option B` in `.env.example`):
   ```
   LLM_PROVIDER=vllm
   LLM_BASE_URL=https://api.fireworks.ai/inference/v1
   LLM_MODEL=accounts/fireworks/models/llama-v3p1-8b-instruct
   LLM_API_KEY=<your Fireworks API key>
   ```
5. Run the backend and frontend locally as in the Quickstart section of
   the main README — no SSH, no Docker, no ROCm setup required. The
   dashboard's "Tokens/seg" reads Fireworks' real `usage` field, so it's
   genuine AMD Instinct throughput.

## Tuning for throughput (the hackathon's "high-performance" ask)

- `--gpu-memory-utilization` and `--max-num-seqs` in
  `deploy/Dockerfile.vllm-rocm` control how many requests vLLM batches
  concurrently — raise `max-num-seqs` to match the swarm's concurrency
  setting in the UI (1x/2x/4x/8x) for best throughput.
- The DocuSwarm dashboard's "Tokens/seg" stat is read from vLLM's real
  `usage` field once `LLM_PROVIDER=vllm` is set, so it reflects actual
  GPU throughput, not the mock estimate used in offline dev mode.
