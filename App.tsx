import React, { useCallback, useMemo, useRef, useState } from 'react';
import type { DocEntry, SwarmEvent, SwarmMetrics } from './types';
import { runSwarm, exportUrl, DEMO_MODE } from './services/swarmService';
import { demoExportUrl, loadSampleFiles } from './services/demoSwarm';
import { FileDropzone } from './components/FileDropzone';
import { DocCard } from './components/DocCard';
import { MetricsBar } from './components/MetricsBar';
import { AlertTriangleIcon, DownloadIcon, ZapIcon } from './components/icons';

const CONCURRENCY_OPTIONS = [1, 2, 4, 8];

export default function App(): React.ReactElement {
  const [files, setFiles] = useState<File[]>([]);
  const [concurrency, setConcurrency] = useState<number>(4);
  const [docs, setDocs] = useState<Record<string, DocEntry>>({});
  const [docOrder, setDocOrder] = useState<string[]>([]);
  const [metrics, setMetrics] = useState<SwarmMetrics | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const handleEvent = useCallback((event: SwarmEvent) => {
    if (!event.doc_id) return;
    setDocOrder((prev) => (prev.includes(event.doc_id) ? prev : [...prev, event.doc_id]));
    setDocs((prev) => ({
      ...prev,
      [event.doc_id]: {
        id: event.doc_id,
        name: event.doc_name,
        status: event.status,
        analysis: event.analysis,
        error: event.error,
        latency_s: event.latency_s,
      },
    }));
    if (event.metrics) setMetrics(event.metrics);
  }, []);

  const handleLoadSamples = useCallback(async () => {
    setError(null);
    try {
      setFiles(await loadSampleFiles());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the sample contracts.');
    }
  }, []);

  const handleRun = useCallback(async () => {
    if (files.length === 0) return;
    setIsRunning(true);
    setError(null);
    setDocs({});
    setDocOrder([]);
    setMetrics(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await runSwarm(files, concurrency, handleEvent, controller.signal);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred.');
    } finally {
      setIsRunning(false);
    }
  }, [files, concurrency, handleEvent]);

  const orderedDocs = useMemo(() => docOrder.map((id) => docs[id]).filter(Boolean), [docOrder, docs]);
  const doneCount = orderedDocs.filter((d) => d.status === 'done').length;
  const hasResults = doneCount > 0 && !isRunning;
  const exportLinks = useMemo(
    () =>
      DEMO_MODE
    ? [
        { label: 'CSV', href: hasResults ? demoExportUrl(orderedDocs, 'csv') : '', file: 'due_diligence_report.csv' },
        { label: 'JSON', href: hasResults ? demoExportUrl(orderedDocs, 'json') : '', file: 'due_diligence_report.json' },
      ]
    : [
        { label: 'Excel', href: exportUrl('xlsx'), file: undefined },
        { label: 'JSON', href: exportUrl('json'), file: undefined },
      ],
    [hasResults, orderedDocs]
  );

  return (
    <div className="min-h-screen bg-gray-900 text-white font-sans">
      <main className="container mx-auto px-4 py-8 md:py-12">
        <header className="text-center mb-8 md:mb-12">
          <div className="inline-flex items-center gap-2 text-xs font-semibold text-sky-400 bg-sky-400/10 border border-sky-700/50 rounded-full px-3 py-1 mb-4">
            <ZapIcon className="h-3.5 w-3.5" />
            Powered by vLLM on AMD Instinct GPUs (ROCm)
          </div>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-emerald-400">
            DocuSwarm
          </h1>
          <p className="mt-4 text-lg text-gray-400 max-w-2xl mx-auto">
            Upload multiple contracts or documents and a swarm of agents analyzes them in parallel — risks, key
            clauses, and dates — while you watch live GPU throughput.
          </p>
        </header>

        <div className="max-w-4xl mx-auto space-y-6">
          {DEMO_MODE && (
            <div className="bg-amber-900/30 border border-amber-700/60 text-amber-200 px-4 py-3 rounded-lg text-sm">
              <strong className="font-bold">Demo mode.</strong> This public page has no backend and no GPU: the
              swarm runs in your browser with the same simulated responses as the backend's mock provider
              (keyword-based risk, 0.6–1.8 s per document). Real results on an AMD Instinct MI300X are in the{' '}
              <a className="underline" href="https://github.com/yanerox69/docuswarm#performance">README</a>.
            </div>
          )}
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 md:p-6 space-y-4">
            <FileDropzone files={files} onChange={setFiles} disabled={isRunning} />
            {DEMO_MODE && (
              <button
                onClick={handleLoadSamples}
                disabled={isRunning}
                className="text-sm text-sky-400 hover:text-sky-300 underline disabled:opacity-50"
              >
                Load 8 sample contracts
              </button>
            )}

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3 text-sm">
                <span className="font-bold text-sky-400">Concurrency</span>
                <div className="flex gap-1">
                  {CONCURRENCY_OPTIONS.map((c) => (
                    <button
                      key={c}
                      disabled={isRunning}
                      onClick={() => setConcurrency(c)}
                      className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                        concurrency === c
                          ? 'bg-sky-600 border-sky-500 text-white'
                          : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600'
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      {c}x
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={handleRun}
                disabled={isRunning || files.length === 0}
                className="inline-flex items-center justify-center px-6 py-3 border border-transparent text-base font-medium rounded-md shadow-sm text-white bg-sky-600 hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-sky-500 disabled:bg-sky-800 disabled:cursor-not-allowed transition-all duration-200"
              >
                <ZapIcon className="mr-2 h-5 w-5" />
                {isRunning ? 'Running swarm...' : `Analyze ${files.length || ''} document${files.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>

          {(isRunning || metrics) && <MetricsBar metrics={metrics} concurrency={concurrency} />}

          {error && (
            <div className="bg-red-900/50 border border-red-700 text-red-300 px-4 py-3 rounded-lg" role="alert">
              <div className="flex items-center">
                <AlertTriangleIcon className="h-5 w-5 mr-3" />
                <div>
                  <strong className="font-bold">Error:</strong>
                  <span className="ml-2">{error}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {orderedDocs.length > 0 && (
          <div className="mt-10 max-w-6xl mx-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">Results ({orderedDocs.length})</h2>
              {hasResults && (
                <div className="flex gap-2">
                  {exportLinks.map((link, i) => (
                    <a
                      key={link.label}
                      href={link.href}
                      download={link.file}
                      className={`inline-flex items-center px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                        i === 0
                          ? 'text-emerald-900 bg-emerald-400 hover:bg-emerald-500'
                          : 'text-indigo-900 bg-indigo-400 hover:bg-indigo-500'
                      }`}
                    >
                      <DownloadIcon className="mr-2 h-4 w-4" />
                      {link.label}
                    </a>
                  ))}
                </div>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {orderedDocs.map((doc) => (
                <DocCard key={doc.id} doc={doc} />
              ))}
            </div>
          </div>
        )}

        {orderedDocs.length === 0 && !isRunning && (
          <div className="text-center py-16 text-gray-500">
            <p>
              {DEMO_MODE
                ? 'Load the sample contracts (or drop your own .txt files) and press "Analyze" to launch the swarm.'
                : 'Upload documents and press "Analyze" to launch the swarm.'}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
