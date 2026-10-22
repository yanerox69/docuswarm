import type { DocEntry, DocumentAnalysis, RiskLevel, SwarmEvent } from '../types';

// Browser-only stand-in for the backend, used by the static demo build
// (VITE_DEMO_MODE=true). It mirrors backend/app/llm.py's mock provider:
// randomized 0.6–1.8 s latency per document, keyword-based risk level and
// token counts estimated from text length. No model and no GPU are involved;
// the point is to let anyone exercise the dashboard, concurrency control and
// export flow from a public HTTPS URL.

export const SAMPLE_FILES = [
  '01-saas-subscription.txt',
  '02-mutual-nda.txt',
  '03-office-lease.txt',
  '04-distribution.txt',
  '05-consulting.txt',
  '06-loan.txt',
  '07-employment.txt',
  '08-software-license.txt',
];

const RISK_WORDS: Record<'high' | 'medium', string[]> = {
  high: ['terminate', 'penalty', 'indemnif', 'liquidated damages', 'exclusiv', 'auto-renew'],
  medium: ['confidential', 'non-compete', 'governing law', 'arbitration'],
};

const DATE_RE =
  /\b(?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4}\b/g;

export async function loadSampleFiles(): Promise<File[]> {
  const base = (import.meta as any).env?.BASE_URL ?? '/';
  return Promise.all(
    SAMPLE_FILES.map(async (name) => {
      const resp = await fetch(`${base}samples/${name}`);
      if (!resp.ok) throw new Error(`Could not load sample ${name}`);
      return new File([await resp.text()], name, { type: 'text/plain' });
    })
  );
}

function analyze(text: string): DocumentAnalysis {
  const lowered = text.toLowerCase();
  let risk: RiskLevel = 'low';
  const flags: string[] = [];
  for (const level of ['high', 'medium'] as const) {
    for (const w of RISK_WORDS[level]) {
      if (lowered.includes(w)) {
        if (risk === 'low' || (risk === 'medium' && level === 'high')) risk = level;
        flags.push(`Contains '${w}' language`);
      }
    }
  }
  return {
    risk_level: risk,
    summary: text.length > 180 ? `${text.slice(0, 180)}...` : text || 'Empty document.',
    red_flags: flags.length ? flags.slice(0, 5) : ['No obvious red flags detected in mock analysis.'],
    key_dates: Array.from(new Set(text.match(DATE_RE) ?? [])).slice(0, 5),
    parties: [],
  };
}

async function readText(file: File): Promise<string | null> {
  return /\.(txt|md)$/i.test(file.name) ? file.text() : null;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });

export async function runDemoSwarm(
  files: File[],
  concurrency: number,
  onEvent: (event: SwarmEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const docs = files.map((f, idx) => ({ id: `doc-${idx}`, name: f.name, file: f }));
  const start = performance.now();
  let completed = 0;
  let tokens = 0;

  for (const d of docs) onEvent({ type: 'status', doc_id: d.id, doc_name: d.name, status: 'queued' });

  // Same shape as the backend's asyncio.Semaphore: at most `concurrency`
  // documents are "in flight" at once.
  let next = 0;
  const worker = async () => {
    while (next < docs.length) {
      const d = docs[next++];
      onEvent({ type: 'status', doc_id: d.id, doc_name: d.name, status: 'running' });
      const t0 = performance.now();
      const text = await readText(d.file);
      if (text === null) {
        completed += 1;
        onEvent({
          type: 'status',
          doc_id: d.id,
          doc_name: d.name,
          status: 'error',
          error: 'Demo mode reads .txt and .md only. PDF and DOCX extraction runs on the backend.',
        });
        continue;
      }
      await sleep(600 + Math.random() * 1200, signal);
      const analysis = analyze(text);
      completed += 1;
      tokens += Math.max(Math.floor(text.length / 4), 1) + Math.max(Math.floor(JSON.stringify(analysis).length / 4), 1);
      const elapsed = (performance.now() - start) / 1000;
      onEvent({
        type: 'status',
        doc_id: d.id,
        doc_name: d.name,
        status: 'done',
        analysis,
        latency_s: Math.round(((performance.now() - t0) / 1000) * 100) / 100,
        metrics: {
          completed,
          total: docs.length,
          tokens_per_s: Math.round((tokens / Math.max(elapsed, 0.01)) * 10) / 10,
          elapsed_s: Math.round(elapsed * 100) / 100,
          concurrency,
        },
      });
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, docs.length)) }, worker));
}

export function demoExportUrl(docs: DocEntry[], fmt: 'csv' | 'json'): string {
  const done = docs.filter((d) => d.status === 'done' && d.analysis);
  if (fmt === 'json') {
    const body = done.map((d) => ({ document: d.name, latency_s: d.latency_s, ...d.analysis }));
    return URL.createObjectURL(new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' }));
  }
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const rows = [['document', 'risk_level', 'summary', 'red_flags', 'key_dates'].join(',')];
  for (const d of done) {
    const a = d.analysis!;
    rows.push([d.name, a.risk_level, a.summary, a.red_flags.join('; '), a.key_dates.join('; ')].map(esc).join(','));
  }
  return URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv' }));
}
