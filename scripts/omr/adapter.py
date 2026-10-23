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
    profile: str = 'standard'
    prepared_scan: bool = False

    def command(self, source: Path, output: Path, sheets: list[int]) -> list[str]:
        if self.profile not in ('standard', 'piano-scan'):
            raise ValueError('Unknown recognition profile')
        command = [str(self.executable), "-batch", "-transcribe", "-export", "-save",
                   "-output", str(output)]
        if self.pdf_resolution is not None:
            command.extend(["-constant", f"org.audiveris.omr.image.ImageLoading.pdfResolution={self.pdf_resolution}"])
        if self.profile == 'piano-scan':
            for constant in PIANO_SCAN_CONSTANTS:
                command.extend(['-constant', constant])
        if self.prepared_scan:
            command.extend(['-constant', 'org.audiveris.omr.image.FilterDescriptor.defaultKind=GLOBAL',
                            '-constant', 'org.audiveris.omr.image.GlobalDescriptor.defaultThreshold=128'])
        if sheets:
            command.extend(["-sheets", *map(str, sheets)])
        return [*command, "--", str(source)]


# Opt-in profile: a single piano piece with curved photographed staff lines.
# Standard recognition remains unchanged for existing imports/other ensembles.
PIANO_SCAN_CONSTANTS = (
    'org.audiveris.omr.sheet.grid.BarsRetriever.forceSinglePart=true',
    'org.audiveris.omr.sheet.ProcessingSwitches.indentations=false',
    'org.audiveris.omr.sheet.grid.LinesRetriever.maxSlopeDiff=0.08',
    'org.audiveris.omr.sheet.grid.LinesRetriever.maxFilamentRotation=0.2',
)


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
