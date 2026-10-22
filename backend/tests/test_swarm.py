import os

os.environ.setdefault("LLM_PROVIDER", "mock")

import pytest

from app.swarm import DocInput, analyze_swarm


@pytest.mark.asyncio
async def test_swarm_processes_all_documents_concurrently():
    docs = [
        DocInput(id="doc-0", name="a.txt", text="This contract has a termination clause."),
        DocInput(id="doc-1", name="b.txt", text="A boring document with nothing notable."),
        DocInput(id="doc-2", name="c.txt", text="Includes indemnification and penalty terms."),
    ]

    events = []
    async for event in analyze_swarm(docs, concurrency=2):
        events.append(event)

    done_events = [e for e in events if e.status == "done"]
    assert len(done_events) == 3
    assert all(e.analysis is not None for e in done_events)
    assert all(e.metrics is not None for e in done_events)
    # metrics should show completion counting up to the full batch
    assert done_events[-1].metrics.completed == 3
    assert done_events[-1].metrics.total == 3


@pytest.mark.asyncio
async def test_mock_keeps_highest_risk_when_both_levels_match():
    docs = [DocInput(id="doc-0", name="a.txt", text="Early exit triggers a penalty. Governing law: Delaware.")]

    done = [e async for e in analyze_swarm(docs, concurrency=1) if e.status == "done"]

    assert done[0].analysis.risk_level == "high"
