"""Replaceable local recognition adapter; no application dependencies."""

from dataclasses import dataclass
from pathlib import Path
import os
import signal
import subprocess
import time
from typing import Protocol


@dataclass
class ProcessResult:
    exit_code: int | None
    elapsed_seconds: float
    status: str


class RecognitionAdapter(Protocol):
    def command(self, source: Path, output: Path, sheets: list[int]) -> list[str]: ...


@dataclass
class AudiverisAdapter:
    executable: Path
    pdf_resolution: int | None = None

    def command(self, source: Path, output: Path, sheets: list[int]) -> list[str]:
        command = [str(self.executable), "-batch", "-transcribe", "-export", "-save",
                   "-output", str(output)]
        if self.pdf_resolution is not None:
            command.extend(["-constant", f"org.audiveris.omr.image.ImageLoading.pdfResolution={self.pdf_resolution}"])
        if sheets:
            command.extend(["-sheets", *map(str, sheets)])
        return [*command, "--", str(source)]


def stop_process(process: subprocess.Popen) -> None:
    """Stop the whole local process group, including a launcher’s JVM."""
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=3)
    except subprocess.TimeoutExpired:
        pass
    # A launcher can exit before its child, so kill the group even after wait.
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    process.wait()


def run_process(command: list[str], log: Path, timeout: float) -> ProcessResult:
    started = time.monotonic()
    with log.open("wb") as stream:
        process = subprocess.Popen(command, stdout=stream, stderr=subprocess.STDOUT,
                                   start_new_session=True)
        try:
            exit_code = process.wait(timeout=timeout)
            status = "completed" if exit_code == 0 else "failed"
        except subprocess.TimeoutExpired:
            stop_process(process)
            exit_code, status = process.returncode, "timed_out"
        except KeyboardInterrupt:
            stop_process(process)
            exit_code, status = process.returncode, "cancelled"
    return ProcessResult(exit_code, round(time.monotonic() - started, 3), status)
