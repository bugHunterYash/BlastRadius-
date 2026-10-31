# =============================================================================
# core.load.runner — k6 subprocess management & sample streaming (C2)
# =============================================================================
# Spawns `k6 run --out json=- <script>`, pipes stdout into k6parse to stream
# RawSamples, enforces hard wall-time and request caps, and manages graceful stop.
# =============================================================================

from __future__ import annotations

import asyncio
import os
import shutil
import tempfile
from collections.abc import AsyncIterator, Callable
from pathlib import Path

from core.load.script import generate_k6_script
from core.metrics.k6parse import RequestJoiner, parse_line
from core.schemas.experiment import (
    CAP_MAX_DURATION_S,
    CAP_MAX_TOTAL_REQUESTS,
    LoadConfig,
    SafetyLimits,
)
from core.schemas.metrics import RawSample


class K6Error(Exception):
    """Base exception for k6 runner failures."""


class K6NotFoundError(K6Error):
    """Raised when the k6 executable is not found in PATH."""


class K6ProcessError(K6Error):
    """Raised when k6 exits with an error status or fails during execution."""


class K6Runner:
    """Manages execution of a k6 load test subprocess."""

    def __init__(
        self,
        load_config: LoadConfig,
        safety_limits: SafetyLimits | None = None,
        *,
        k6_bin: str = "k6",
    ) -> None:
        self.load_config = load_config
        self.safety_limits = safety_limits or SafetyLimits()
        self.k6_bin = k6_bin
        self._proc: asyncio.subprocess.Process | None = None
        self._temp_dir: str | None = None
        self._script_path: Path | None = None
        self._stopped: bool = False
        self.total_requests: int = 0

    def prepare_script(self) -> Path:
        """Renders the k6 script into a temporary file."""
        rendered = generate_k6_script(self.load_config, safety=self.safety_limits)
        self._temp_dir = tempfile.mkdtemp(prefix="blastradius_k6_")
        self._script_path = Path(self._temp_dir) / "test.js"
        self._script_path.write_text(rendered.source, encoding="utf-8")
        return self._script_path

    async def run_stream(
        self,
        start_epoch: float,
        *,
        on_sample: Callable[[RawSample], None] | None = None,
    ) -> AsyncIterator[RawSample]:
        """Runs k6 and yields RawSamples in real-time as they are parsed."""
        k6_path = shutil.which(self.k6_bin)
        if not k6_path:
            raise K6NotFoundError(
                f"k6 executable '{self.k6_bin}' not found in PATH. Install k6 to run live load tests."
            )

        if not self._script_path:
            self.prepare_script()

        joiner = RequestJoiner(start_epoch=start_epoch)
        wall_time_limit = min(self.load_config.total_duration_s + 10, CAP_MAX_DURATION_S + 15)

        self._proc = await asyncio.create_subprocess_exec(
            k6_path,
            "run",
            "--out",
            "json=-",
            str(self._script_path),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=self._temp_dir,
        )

        try:
            loop = asyncio.get_running_loop()
            start_wall = loop.time()

            assert self._proc.stdout is not None
            while True:
                # Check wall time limit
                if (loop.time() - start_wall) > wall_time_limit:
                    await self.stop()
                    break

                # Check max requests safety net
                if self.total_requests > CAP_MAX_TOTAL_REQUESTS:
                    await self.stop()
                    break

                line_bytes = await self._proc.stdout.readline()
                if not line_bytes:
                    break

                line = line_bytes.decode("utf-8", errors="replace")
                ev = parse_line(line)
                if ev is None:
                    continue

                sample = joiner.add(ev)
                if sample is not None:
                    self.total_requests += 1
                    if on_sample is not None:
                        on_sample(sample)
                    yield sample

            # Flush any remaining unjoined points
            for sample in joiner.flush():
                self.total_requests += 1
                if on_sample is not None:
                    on_sample(sample)
                yield sample

            await self._proc.wait()

        finally:
            self.cleanup()

    async def stop(self) -> None:
        """Gracefully terminates k6 process, escalating to kill after timeout."""
        if self._proc is None or self._stopped:
            return
        self._stopped = True

        try:
            if self._proc.returncode is None:
                self._proc.terminate()
                try:
                    await asyncio.wait_for(self._proc.wait(), timeout=5.0)
                except asyncio.TimeoutError:
                    if self._proc.returncode is None:
                        self._proc.kill()
                        await self._proc.wait()
        except ProcessLookupError:
            pass

    def cleanup(self) -> None:
        """Removes temporary files and script directories."""
        if self._temp_dir and os.path.exists(self._temp_dir):
            try:
                shutil.rmtree(self._temp_dir, ignore_errors=True)
            except Exception:
                pass
            self._temp_dir = None
            self._script_path = None
