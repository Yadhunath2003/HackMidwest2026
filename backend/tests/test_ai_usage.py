from concurrent.futures import ThreadPoolExecutor

import httpx
import pytest

from app import ai, ai_usage


def test_truncated_attempt_usage_is_included_in_total(monkeypatch):
    monkeypatch.setattr(ai, "is_configured", lambda: True)
    replies = iter([
        {"choices": [{"finish_reason": "length", "message": {"content": "partial"}}],
         "usage": {"prompt_tokens": 100, "completion_tokens": 700, "total_tokens": 800}},
        {"choices": [{"finish_reason": "stop", "message": {"content": "complete"}}],
         "usage": {"prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150}},
    ])
    monkeypatch.setattr(ai.httpx, "post", lambda *args, **kwargs: httpx.Response(200, json=next(replies)))
    updates = []
    with ai_usage.track(updates.append) as usage:
        with pytest.raises(ai.AIResponseTruncated):
            ai.chat([])
        assert ai.chat([]) == "complete"
        assert usage.snapshot() == {"requests": 2, "reported_requests": 2, "unreported_requests": 0,
            "cache_hits": 0, "prompt_tokens": 200, "completion_tokens": 750, "total_tokens": 950}
    assert updates[-1]["total_tokens"] == 950


def test_missing_provider_usage_is_not_fabricated(monkeypatch):
    monkeypatch.setattr(ai, "is_configured", lambda: True)
    monkeypatch.setattr(ai.httpx, "post", lambda *args, **kwargs: httpx.Response(200, json={
        "choices": [{"message": {"content": "complete"}, "finish_reason": "stop"}]}))
    with ai_usage.track() as usage:
        ai.chat([])
        assert usage.snapshot()["unreported_requests"] == 1
        assert usage.snapshot()["total_tokens"] == 0


def test_concurrent_usage_scopes_do_not_mix_or_leak():
    def work(count):
        with ai_usage.track() as usage:
            for _ in range(count):
                ai_usage.request_started()
                ai_usage.record_response({"usage": {"prompt_tokens": 2, "completion_tokens": 3, "total_tokens": 5}})
            ai_usage.cache_hit()
            return usage.snapshot()
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(work, [3, 7]))
    assert [result["total_tokens"] for result in results] == [15, 35]
    with ai_usage.track() as usage:
        assert usage.snapshot()["requests"] == 0
