"""Optional local five-line scan dewarping; never infer or synthesize notation.

The original PDF remains authoritative. This module is not enabled by importing
it: callers explicitly request preparation, retain maps, and select the provider.
Scientific/image dependencies are optional and imported only inside operations.
"""
from dataclasses import dataclass
import json
import math
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time
from typing import Any, Callable

MAX_PAGES = 20
MAX_PAGE_PIXELS = 24_000_000
MAX_TOTAL_PIXELS = 180_000_000
MAX_SECONDS = 180
DPI = 400
FAILURE = 'Optional scan straightening was skipped; the original PDF is unchanged.'


class GeometryRefused(ValueError):
    """Insufficient evidence or a bounded preparation limit, not a score error."""


def _dependencies():
    import numpy as np
    from PIL import Image
    from scipy.ndimage import gaussian_filter1d, maximum_filter1d
    from scipy.signal import find_peaks
    return np, Image, gaussian_filter1d, maximum_filter1d, find_peaks


@dataclass(frozen=True)
class StaffGeometry:
    width: int
    height: int
    interline: float
    curves: Any
    targets: Any
    evidence: tuple[dict, ...]


def detect_staff_geometry(original, check: Callable[[], None] = lambda: None) -> StaffGeometry:
    """Detect periodic five-line groups without a preset staff count or position.

    Confidence concerns the detected groups, not proof that no staff was missed.
    The operation refuses a page if any candidate group has uncertain tracking.
    """
    np, Image, gaussian_filter1d, maximum_filter1d, find_peaks = _dependencies()
    if original.ndim != 2:
        raise GeometryRefused('Expected one grayscale page')
    h0, w0 = original.shape
    if min(h0, w0) < 200 or h0 * w0 > MAX_PAGE_PIXELS:
        raise GeometryRefused('Page pixel limit')
    factor = min(1, 2200 / h0)
    image = np.asarray(Image.fromarray(original).resize(
        (round(w0 * factor), round(h0 * factor)), Image.Resampling.BILINEAR))
    height, width = image.shape
    half, step = max(5, width // 180), max(10, width // 90)
    xs = np.arange(round(.06 * width), round(.985 * width), step)
    ink = image < 225
    # A fixed brightness cutoff would classify a dark photographed page's
    # paper as ink. Use local contrast only for that case; bright-page
    # tracking retains its established faint-line sensitivity.
    if float(np.mean(ink)) > .35:
        ink = binarize_scan(image) < 128
    profiles = np.array([gaussian_filter1d(
        ink[:, max(0, x - half):min(width, x + half)].mean(axis=1), .5) for x in xs])
    centered = profiles - profiles.mean(axis=1, keepdims=True)
    lags = np.arange(max(3, height // 700), max(10, height // 50))
    correlation = np.array([np.mean(centered[:, distance:] * centered[:, :-distance]) for distance in lags])
    peaks, _ = find_peaks(correlation)
    if not len(peaks):
        raise GeometryRefused('No periodic staff spacing')
    strong = [index for index in peaks if correlation[index] >= .75 * max(correlation[peaks])]
    if not strong or correlation[strong[0]] < .003:
        raise GeometryRefused('Weak staff spacing evidence')
    distance = float(lags[strong[0]])
    ordinates = np.arange(height)
    spacings = np.arange(distance * .9, distance * 1.1 + .01, max(.2, distance * .025))
    combs = []
    for profile in profiles:
        check()
        patterns = []
        for spacing in spacings:
            rows = np.stack([np.interp(ordinates + member * spacing, ordinates, profile, left=0, right=0)
                             for member in (-2, -1, 0, 1, 2)])
            # Four of five line traces must carry ink; an isolated slur is not a staff.
            patterns.append(np.quantile(rows, .2, axis=0))
        combs.append(np.max(patterns, axis=0))
    combs = np.array(combs)
    aggregate = np.mean(maximum_filter1d(combs, size=round(5 * distance) | 1, axis=1), axis=0)
    smooth = gaussian_filter1d(aggregate, max(2, distance * .65))
    seeds, _ = find_peaks(smooth, prominence=.12, distance=round(6 * distance), height=.5)
    if not len(seeds) or len(seeds) > 100:
        raise GeometryRefused('No bounded set of confident staff groups')
    curves, evidence = [], []
    for seed in seeds:
        check()
        rows = np.arange(max(3, round(seed - 6 * distance)), min(height - 3, round(seed + 6 * distance)) + 1)
        scores = combs[:, rows]
        cost = -scores[0] * 10 + .0005 * (rows - seed) ** 2
        delta = rows[:, None] - rows[None, :]
        limit = max(2, round(step * .20))
        transition = np.where(abs(delta) <= limit, .15 * delta ** 2, 1e6)
        previous = []
        for index in range(1, len(xs)):
            proposal = cost[:, None] + transition
            choice = proposal.argmin(axis=0)
            previous.append(choice)
            cost = proposal[choice, np.arange(len(rows))] - scores[index] * 10
        path = [int(cost.argmin())]
        for choice in reversed(previous):
            path.append(int(choice[path[-1]]))
        path = np.array(path[::-1])
        confidence = scores[np.arange(len(xs)), path]
        values = gaussian_filter1d(rows[path].astype(float), 2)
        record = {'medianConfidence': float(np.median(confidence)),
                  'confidentColumnFraction': float(np.mean(confidence > .45)),
                  'curveRangePixels': float(np.ptp(values) / factor)}
        if record['medianConfidence'] < .55 or record['confidentColumnFraction'] < .8:
            raise GeometryRefused('Ambiguous staff tracking')
        curve = np.interp(np.arange(width), xs, values)
        if curves and np.median(curve - curves[-1]) < 5 * distance:
            raise GeometryRefused('Overlapping staff candidates')
        curves.append(curve)
        evidence.append(record)
    curves = np.array([np.interp(np.arange(w0), np.arange(width) / factor, curve / factor) for curve in curves])
    targets = np.median(curves, axis=1)
    distance /= factor
    if np.any(np.diff(targets) < 9 * distance):
        raise GeometryRefused('Insufficient safe space between staves')
    return StaffGeometry(w0, h0, distance, curves, targets, tuple(evidence))


def warp_staff_geometry(original, geometry: StaffGeometry, check: Callable[[], None] = lambda: None):
    """Resample source columns with invertible piecewise-linear translations.

    Notes and their nearby staff lines receive the same translation. Only gaps
    bridge different displacements. No symbol or staff line is synthesized;
    pixel interpolation can soften edges, so originals remain retained.
    """
    np, *_ = _dependencies()
    height, width = original.shape
    if (width, height) != (geometry.width, geometry.height):
        raise GeometryRefused('Geometry does not match image')
    warped = np.empty_like(original)
    source_anchors, destination_anchors = [], []
    maximum = 0.
    for x in range(width):
        if x % 32 == 0:
            check()
        destinations, sources = [0.], [0.]
        for index, target in enumerate(geometry.targets):
            band = geometry.interline * 4.5
            destinations.extend((target - band, target + band))
            sources.extend((geometry.curves[index, x] - band, geometry.curves[index, x] + band))
        destinations.append(float(height - 1))
        sources.append(float(height - 1))
        if (not np.all(np.isfinite(sources)) or not np.all(np.isfinite(destinations))
                or np.any(np.diff(sources) <= 0) or np.any(np.diff(destinations) <= 0)):
            raise GeometryRefused('Non-monotonic or crossing staff mapping')
        source_y = np.interp(np.arange(height), destinations, sources)
        maximum = max(maximum, float(np.max(abs(source_y - np.arange(height)))))
        warped[:, x] = np.interp(source_y, np.arange(height), original[:, x]).clip(0, 255).astype('uint8')
        source_anchors.append(sources)
        destination_anchors.append(destinations)
    return warped, np.array(source_anchors), np.array(destination_anchors), maximum


def binarize_scan(original):
    """Recover faint ink without turning pure white paper into invented ink.

    Audiveris's uncapped mean*.8 + deviation*.9 can exceed 255 beside
    thin black lines. Keep that useful faint-line sensitivity, cap the
    threshold, and give the provider an already binary recognition image.
    Grayscale page images remain separate for original-lettering crops.
    """
    np, *_ = _dependencies()
    from scipy.ndimage import uniform_filter
    pixels = original.astype(np.float32)
    mean = uniform_filter(pixels, size=37, mode='nearest')
    squares = uniform_filter(pixels * pixels, size=37, mode='nearest')
    deviation = np.sqrt(np.maximum(0, squares - mean * mean))
    if float(np.mean(pixels < 225)) > .35:
        # Dark photographed paper needs a local paper/ink contrast test,
        # rather than scaling its already low background brightness.
        threshold = np.minimum(254., mean - 8.)
    else:
        threshold = np.minimum(254., .8 * mean + .9 * deviation)
    return np.where(pixels <= threshold, 0, 255).astype('uint8')


def prepare_piano_scan(pdf: Path, destination: Path, pages: list[int], timeout: float) -> tuple[Path | None, list[str]]:
    """Return an optional complete 400dpi TIFF and retained bidirectional maps.

    All PDF pages are staged so selected provider sheet numbers remain original
    PDF page numbers. `pages` validates the requested subset, never omits pages.
    Missing dependencies, uncertain geometry or limits leave the PDF unchanged.
    """
    prepared = None
    started = time.monotonic()
    try:
        if not math.isfinite(timeout) or timeout <= 0:
            raise GeometryRefused('No preparation time remains')
        deadline = started + min(timeout, MAX_SECONDS)
        pdf, destination = Path(pdf), Path(destination)
        def check():
            if time.monotonic() >= deadline:
                raise GeometryRefused('Preparation time limit')
            if (pdf.parent / 'cancel.requested').exists() or (destination / 'cancel.requested').exists():
                raise GeometryRefused('Preparation cancelled')
        check()
        np, Image, *_ = _dependencies()
        pdfinfo, pdftoppm = shutil.which('pdfinfo'), shutil.which('pdftoppm')
        if not pdfinfo or not pdftoppm:
            raise GeometryRefused('Local Poppler tools unavailable')
        if not pdf.is_file() or pdf.stat().st_size > 100 * 1024 * 1024:
            raise GeometryRefused('Unsupported PDF size')
        metadata = subprocess.run([pdfinfo, str(pdf)], capture_output=True, timeout=min(10, deadline - time.monotonic()), check=True)
        if len(metadata.stdout) > 128 * 1024:
            raise GeometryRefused('Oversized PDF metadata')
        count_match = re.search(rb'^Pages:\s+(\d+)\s*$', metadata.stdout, re.MULTILINE)
        if not count_match:
            raise GeometryRefused('PDF page count unavailable')
        count = int(count_match.group(1))
        if not 1 <= count <= MAX_PAGES:
            raise GeometryRefused('Optional straightening supports at most 20 pages')
        if not isinstance(pages, list) or any(type(page) is not int or not 1 <= page <= count for page in pages):
            raise GeometryRefused('Invalid source page selection')
        check()
        # Reject excessive raster dimensions before Poppler allocates an image.
        boxes = subprocess.run([pdfinfo, '-f', '1', '-l', str(count), '-box', str(pdf)],
                               capture_output=True, timeout=min(10, deadline - time.monotonic()), check=True)
        if len(boxes.stdout) > 128 * 1024:
            raise GeometryRefused('Oversized PDF page metadata')
        sizes = re.findall(rb'^Page(?:\s+\d+)?\s+size:\s+([0-9.]+)\s+x\s+([0-9.]+)\s+pts',
                           boxes.stdout, re.MULTILINE)
        if len(sizes) != count:
            raise GeometryRefused('Complete PDF page dimensions unavailable')
        estimated_pixels = 0
        for width_points, height_points in sizes:
            width = math.ceil(float(width_points) * DPI / 72) + 1
            height = math.ceil(float(height_points) * DPI / 72) + 1
            if min(width, height) < 200 or max(width, height) > 12000 or width * height > MAX_PAGE_PIXELS:
                raise GeometryRefused('Page pixel limit')
            estimated_pixels += width * height
        if estimated_pixels > MAX_TOTAL_PIXELS:
            raise GeometryRefused('Total pixel limit')
        destination.mkdir(parents=True, exist_ok=True)
        prepared = Path(tempfile.mkdtemp(prefix='scan-', dir=destination))
        reports, total_pixels, outputs = [], 0, []
        for page in range(1, count + 1):
            check()
            source = prepared / 'source'
            subprocess.run([pdftoppm, '-f', str(page), '-l', str(page), '-r', str(DPI), '-singlefile', '-gray',
                            str(pdf), str(source)], capture_output=True, timeout=min(60, deadline - time.monotonic()), check=True)
            check()
            with Image.open(source.with_suffix('.pgm')) as image:
                width, height = image.size
                if width * height > MAX_PAGE_PIXELS or min(width, height) < 200:
                    raise GeometryRefused('Page pixel limit')
                total_pixels += width * height
                if total_pixels > MAX_TOTAL_PIXELS:
                    raise GeometryRefused('Total pixel limit')
                original = np.asarray(image.convert('L'))
            geometry = detect_staff_geometry(original, check)
            warped, sources, destinations, maximum = warp_staff_geometry(original, geometry, check)
            filename = prepared / f'page-{page}.png'
            Image.fromarray(warped).save(filename, dpi=(DPI, DPI))
            np.savez_compressed(prepared / f'page-{page}-map.npz', source_anchors=sources,
                                destination_anchors=destinations, source_shape=np.array(original.shape))
            reports.append({'sourcePage': page, 'width': width, 'height': height,
                            'staffCount': len(geometry.targets), 'interlinePixels': geometry.interline,
                            'maximumDisplacementPixels': maximum, 'evidence': geometry.evidence,
                            'map': f'page-{page}-map.npz'})
            binary = prepared / f'binary-{page}.png'
            Image.fromarray(binarize_scan(warped)).save(binary, dpi=(DPI, DPI))
            outputs.append(binary)
            source.with_suffix('.pgm').unlink()
        check()
        # TIFF frame order preserves original page numbers, including unselected pages.
        frames = [Image.open(path) for path in outputs]
        try:
            target = prepared / 'score.tiff'
            frames[0].save(target, save_all=True, append_images=frames[1:], compression='tiff_deflate', dpi=(DPI, DPI))
        finally:
            for frame in frames:
                frame.close()
        check()
        for binary in outputs:
            binary.unlink()
        with Image.open(target) as image:
            if image.n_frames != count:
                raise GeometryRefused('Incomplete staged TIFF')
        (prepared / 'geometry.json').write_text(json.dumps({'version': 1, 'dpi': DPI, 'requestedPages': pages,
            'recognitionImage': 'Binary TIFF: local mean*.8 + deviation*.9, 37px window, threshold capped at254. Grayscale PNGs retained for page lettering.',
            'mapping': 'At column x, destination-to-source is interp(y,destination_anchors[x],source_anchors[x]); '
                       'source-to-destination swaps anchors. x is unchanged. All PDF pages are retained in original order.',
            'pages': reports}, indent=2))
        return target, ['Prepared a local straightened scan with retained source-page maps; compare recognized notation with the original PDF.']
    except KeyboardInterrupt:
        if prepared is not None:
            shutil.rmtree(prepared, ignore_errors=True)
        raise
    except (ImportError, ModuleNotFoundError):
        diagnostic = 'Optional local image dependencies unavailable'
    except GeometryRefused as error:
        diagnostic = str(error)[:120]
    except Exception:
        diagnostic = 'Local scan preparation could not finish'
    if prepared is not None:
        shutil.rmtree(prepared, ignore_errors=True)
    return None, [f'{FAILURE} {diagnostic}.']
