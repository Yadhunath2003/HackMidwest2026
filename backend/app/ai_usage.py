"""Per-backtest usage accounting, isolated across concurrent worker threads."""

from contextlib import contextmanager
from contextvars import ContextVar

_current: ContextVar = ContextVar("ai_usage", default=None)


class Usage:
    def __init__(self, on_update=None):
        self.on_update = on_update
        self.values = {"requests": 0, "reported_requests": 0, "cache_hits": 0,
                       "prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}

    def snapshot(self):
        return {**self.values, "unreported_requests": self.values["requests"] - self.values["reported_requests"]}

    def update(self, **increments):
        for key, value in increments.items():
            self.values[key] += value
        if self.on_update:
            self.on_update(self.snapshot())


@contextmanager
def track(on_update=None):
    usage = Usage(on_update)
    token = _current.set(usage)
    try:
        yield usage
    finally:
        _current.reset(token)


def request_started():
    if usage := _current.get():
        usage.update(requests=1)


def record_response(data):
    usage = _current.get()
    counts = data.get("usage") if isinstance(data, dict) else None
    if usage is None or not isinstance(counts, dict):
        return
    keys = ("prompt_tokens", "completion_tokens", "total_tokens")
    if all(type(counts.get(key)) is int and counts[key] >= 0 for key in keys):
        usage.update(reported_requests=1, **{key: counts[key] for key in keys})


def cache_hit():
    if usage := _current.get():
        usage.update(cache_hits=1)
