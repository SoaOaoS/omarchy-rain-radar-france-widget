#!/usr/bin/env python3
"""Converts one radar frame (RainViewer map tiles) into what the widget draws
and computes with, using nothing but Python's standard library:

  <out>.png                  the rain rate, coloured with rain-colorramp.txt,
                             800 x 639 pixels over the map (MapModel.bounds),
                             evenly spaced in longitude and latitude, as the
                             map draws it (cosine-scaled equirectangular)
  <out>.nowcast-grid.json    {cols, rows, bounds, values}: 305 x 244 cells of
                             about 5 km over the same box, each the mean rain
                             rate over the radar pixels it covers (dry ones as
                             0), for the nowcast, the graph and the chances

usage: radar-convert.py <tiles-basename> <output-basename>

The frame is four 512 x 512 tiles at zoom 5 (columns 15-16, rows 10-11:
11.25 W - 11.25 E, 40.98 - 55.78 N, about 1.7 km per pixel over France), read
from <tiles-basename>.<column>.<row>.png. RainViewer draws them in its
"Universal Blue" colours, one colour per dBZ from -10 to 64, without
smoothing, so each pixel's colour gives back its reflectivity exactly
(COLOURS below, from RainViewer's published colour table). A picture in other
colours stops with a message, rather than being read wrongly.

dBZ becomes rain rate by Marshall-Palmer, rate = (10^(dBZ/10) / 200)^(1/1.6).
Rates below 0.05 mm/h count as dry, and so does a transparent pixel: the tiles
do not tell "no rain" from "outside radar range".

The tiles are in Web Mercator: a pixel's column is linear in longitude and its
row in the Mercator latitude, so every pixel's place on the map follows from
its row and column alone. Then, binned:

  - a grid cell takes the mean over all its radar pixels, dry ones as 0;
  - a map pixel (about 1.9 km) takes the mean over its wet radar pixels, so a
    small shower keeps its strength on the map.
"""
import json
import math
import os
import re
import signal
import struct
import sys
import zlib

# Map domain, kept in sync with MapModel.js's `bounds` (tests/maprange.test.cjs).
WEST, SOUTH, EAST, NORTH = -9.5, 41.0, 10.5, 52.0
PNG_W, PNG_H = 800, 639
GRID_COLS, GRID_ROWS = 305, 244
RATE_FLOOR = 0.05
ZR_A, ZR_B = 200.0, 1.6

# The tiles, kept in sync with RadarModel.js's TILES (tests/maprange.test.cjs).
ZOOM, TILE_SIZE = 5, 512
TILE_X0, TILE_Y0, TILES_X, TILES_Y = 15, 10, 2, 2

# Limits, far above RainViewer's tiles (10 to 60 kB each), so a damaged or
# hostile file is refused instead of using memory or time.
MAX_FILE_BYTES = 4_000_000
DEADLINE_SECONDS = 30      # the whole conversion; a frame takes about a second
# More unknown colours than this share of the coloured pixels: not the
# pictures this was written for.
MAX_UNKNOWN_SHARE = 0.02
SAFE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")

# RainViewer's "Universal Blue" colour for each dBZ from -10 to 65 (RGBA hex),
# from https://www.rainviewer.com/files/rainviewer_api_colors_table.csv.
# 65 dBZ and above are all white: read as 65.
FIRST_DBZ = -10
COLOURS = (
    "63615914 66635a19 69665c1e 6c685d24 6f6b5f29 726e612e 75706234 78736439 7c75653e 7f786744 "
    "827b6949 857d6a4e 88806c54 8b826d59 8e856f5e 92887164 9e93756e aa9e7978 b6a97e82 c2b4828c "
    "cec08796 d2c48ba0 d6c88faa dacc93b4 ded097be 88ddeeff 6cd1ebff 51c5e8ff 36bae5ff 1baee2ff "
    "00a3e0ff 009ad5ff 0091caff 0088bfff 007fb4ff 0077aaff 0070a3ff 00699cff 006295ff 005b8eff "
    "005588ff 005180ff 004e78ff 004a70ff 004768ff ffee00ff ffe000ff ffd200ff ffc500ff ffb700ff "
    "ffaa00ff ff9f00ff ff9500ff ff8b00ff ff8100ff ff4400ff f23600ff e62800ff d91b00ff cd0d00ff "
    "c10000ff a80000ff 8f0000ff 760000ff 5d0000ff ffaaffff ff9fffff ff95ffff ff8bffff ff81ffff "
    "ff77ffff ff6cffff ff62ffff ff58ffff ff4effff ffffffff"
).split()


class Unsupported(Exception):
    pass


def rate_of(dbz):
    return ((10 ** (dbz / 10)) / ZR_A) ** (1 / ZR_B)


def colour_rates():
    """{RGBA bytes: rain rate in mm/h}; 0 for the colours below RATE_FLOOR."""
    table = {}
    for i, colour in enumerate(COLOURS):
        rate = rate_of(FIRST_DBZ + i)
        table[bytes.fromhex(colour)] = rate if rate >= RATE_FLOOR else 0.0
    return table


# ---- A reader for 8-bit PNG (RGBA, RGB or palette; not interlaced) ----

def read_png(data):
    """(width, height, RGBA bytes) of a PNG file's picture."""
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise Unsupported("not a PNG file")
    o = 8
    header = palette = alpha = None
    packed = []
    while o + 8 <= len(data):
        size, tag = struct.unpack_from(">I4s", data, o)
        body = data[o + 8:o + 8 + size]
        if len(body) != size:
            raise Unsupported("a PNG chunk leaves the file")
        if tag == b"IHDR":
            header = struct.unpack(">IIBBBBB", body)
        elif tag == b"PLTE":
            palette = body
        elif tag == b"tRNS":
            alpha = body
        elif tag == b"IDAT":
            packed.append(body)
        elif tag == b"IEND":
            break
        o += 12 + size
    if header is None:
        raise Unsupported("a PNG without a header")
    width, height, depth, kind, _, _, interlace = header
    if (width, height) != (TILE_SIZE, TILE_SIZE):
        raise Unsupported("a %d x %d picture (expected %d x %d)" % (width, height, TILE_SIZE, TILE_SIZE))
    if depth != 8 or interlace != 0 or kind not in (2, 3, 6):
        raise Unsupported("PNG depth %d, colour type %d, interlace %d" % (depth, kind, interlace))
    bpp = {2: 3, 3: 1, 6: 4}[kind]
    stride = width * bpp
    want = (stride + 1) * height
    # never inflate past the picture's own size
    z = zlib.decompressobj()
    raw = z.decompress(b"".join(packed), want)
    if z.unconsumed_tail or len(raw) != want:
        raise Unsupported("the PNG's data has the wrong size")

    out = bytearray(stride * height)
    zero = bytes(stride)
    prev = zero
    for y in range(height):
        o = y * (stride + 1)
        ftype = raw[o]
        line = raw[o + 1:o + 1 + stride]
        if ftype == 0 or (line == zero and (ftype == 1 or prev == zero)):
            row = line
        elif ftype == 2 and line == zero:
            row = prev
        else:
            row = bytearray(line)
            if ftype == 1:
                for i in range(bpp, stride):
                    row[i] = (row[i] + row[i - bpp]) & 255
            elif ftype == 2:
                for i in range(stride):
                    row[i] = (row[i] + prev[i]) & 255
            elif ftype == 3:
                for i in range(stride):
                    left = row[i - bpp] if i >= bpp else 0
                    row[i] = (row[i] + ((left + prev[i]) >> 1)) & 255
            elif ftype == 4:
                for i in range(stride):
                    a = row[i - bpp] if i >= bpp else 0
                    b = prev[i]
                    c = prev[i - bpp] if i >= bpp else 0
                    pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                    row[i] = (row[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
            else:
                raise Unsupported("PNG filter %d" % ftype)
            row = bytes(row)
        out[y * stride:(y + 1) * stride] = row
        prev = row

    if kind == 6:
        return width, height, bytes(out)
    if kind == 2:
        rgba = bytearray(b"\xff") * (width * height * 4)
        rgba[0::4], rgba[1::4], rgba[2::4] = out[0::3], out[1::3], out[2::3]
        return width, height, bytes(rgba)
    if palette is None:
        raise Unsupported("a palette PNG without its palette")
    entries = []
    for i in range(256):
        rgb = palette[3 * i:3 * i + 3] if 3 * i + 3 <= len(palette) else b"\0\0\0"
        entries.append(rgb + bytes([alpha[i] if alpha and i < len(alpha) else 255]))
    return width, height, b"".join(entries[i] for i in out)


# ---- Where each tile pixel falls on the map ----

def geometry():
    """For every row and column of the 2 x 2 tile mosaic: its grid row/column
    and map row/column (-1 outside the map), and how many pixels each grid row
    and column holds."""
    world = TILE_SIZE * (1 << ZOOM)
    width, height = TILE_SIZE * TILES_X, TILE_SIZE * TILES_Y
    grid_col, map_col = [-1] * width, [-1] * width
    cols_in = [0] * GRID_COLS
    for c in range(width):
        lon = (TILE_X0 * TILE_SIZE + c + .5) / world * 360 - 180
        if WEST <= lon < EAST:
            grid_col[c] = int((lon - WEST) * GRID_COLS / (EAST - WEST))
            map_col[c] = int((lon - WEST) * PNG_W / (EAST - WEST))
            cols_in[grid_col[c]] += 1
    grid_row, map_row = [-1] * height, [-1] * height
    rows_in = [0] * GRID_ROWS
    for r in range(height):
        y = (TILE_Y0 * TILE_SIZE + r + .5) / world
        lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y))))
        if SOUTH < lat <= NORTH:
            grid_row[r] = int((NORTH - lat) * GRID_ROWS / (NORTH - SOUTH))
            map_row[r] = int((NORTH - lat) * PNG_H / (NORTH - SOUTH))
            rows_in[grid_row[r]] += 1
    return grid_col, map_col, cols_in, grid_row, map_row, rows_in


# ---- Conversion ----

def read_ramp(path):
    stops = []
    for line in open(path):
        parts = line.split()
        if len(parts) == 5 and not line.startswith("#") and parts[0] != "nv":
            stops.append((float(parts[0]),) + tuple(int(v) for v in parts[1:]))
    return stops


def colour(rate, stops):
    if rate <= stops[0][0]:
        return stops[0][1:]
    for lo, hi in zip(stops, stops[1:]):
        if rate <= hi[0]:
            t = (rate - lo[0]) / (hi[0] - lo[0])
            return tuple(int(round(a + (b - a) * t)) for a, b in zip(lo[1:], hi[1:]))
    return stops[-1][1:]


def write_png(path, width, height, rgba):
    def chunk(tag, body):
        return struct.pack(">I", len(body)) + tag + body + struct.pack(">I", zlib.crc32(tag + body) & 0xFFFFFFFF)
    rows = b"".join(b"\0" + bytes(rgba[y * width * 4:(y + 1) * width * 4]) for y in range(height))
    png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(rows, 6)) + chunk(b"IEND", b""))
    tmp = path + ".tmp"
    with open(tmp, "wb") as f:
        f.write(png)
    os.replace(tmp, path)


def read_tile(path):
    if os.path.getsize(path) > MAX_FILE_BYTES:
        raise Unsupported("a tile is larger than %d bytes" % MAX_FILE_BYTES)
    with open(path, "rb") as f:
        return read_png(f.read(MAX_FILE_BYTES + 1))[2]


def convert(in_base, out_base, ramp_path):
    # the output stays in its own folder: a plain file name, no path in it
    if not SAFE_NAME.match(os.path.basename(out_base)) or not os.path.isdir(os.path.dirname(os.path.abspath(out_base))):
        raise Unsupported("unsafe output name %r" % out_base)

    rates = colour_rates()
    grid_col, map_col, cols_in, grid_row, map_row, rows_in = geometry()
    cell_sum = [0.0] * (GRID_COLS * GRID_ROWS)
    map_sum = [0.0] * (PNG_W * PNG_H)
    map_n = [0] * (PNG_W * PNG_H)
    coloured = unknown = 0
    run = re.compile(rb"[^\x00]+")  # a run of pixels that are not fully transparent

    for ty in range(TILES_Y):
        for tx in range(TILES_X):
            rgba = read_tile("%s.%d.%d.png" % (in_base, TILE_X0 + tx, TILE_Y0 + ty))
            stride = TILE_SIZE * 4
            for y in range(TILE_SIZE):
                grow = grid_row[ty * TILE_SIZE + y]
                if grow < 0:
                    continue
                mrow = map_row[ty * TILE_SIZE + y]
                base = y * stride
                for m in run.finditer(rgba[base + 3:base + stride:4]):
                    for x in range(m.start(), m.end()):
                        gcol = grid_col[tx * TILE_SIZE + x]
                        if gcol < 0:
                            continue
                        coloured += 1
                        v = rates.get(rgba[base + 4 * x:base + 4 * x + 4])
                        if v is None:
                            unknown += 1
                            continue
                        if v > 0:
                            cell_sum[grow * GRID_COLS + gcol] += v
                            pix = mrow * PNG_W + map_col[tx * TILE_SIZE + x]
                            map_sum[pix] += v
                            map_n[pix] += 1

    if unknown > MAX_UNKNOWN_SHARE * coloured:
        raise Unsupported("%d of %d pixels are in colours this version does not know" % (unknown, coloured))

    values = []
    for r in range(GRID_ROWS):
        for c in range(GRID_COLS):
            n = rows_in[r] * cols_in[c]
            v = round(cell_sum[r * GRID_COLS + c] / n, 3) if n > 0 else 0
            values.append(v if v else 0)
    grid = {"cols": GRID_COLS, "rows": GRID_ROWS,
            "bounds": {"west": WEST, "south": SOUTH, "east": EAST, "north": NORTH}, "values": values}
    tmp = out_base + ".nowcast-grid.json.tmp"
    with open(tmp, "w") as f:
        json.dump(grid, f, separators=(",", ":"))
    os.replace(tmp, out_base + ".nowcast-grid.json")

    stops = read_ramp(ramp_path)
    rgba = bytearray(PNG_W * PNG_H * 4)
    for k in range(PNG_W * PNG_H):
        if map_n[k]:
            rgba[4 * k:4 * k + 4] = bytes(colour(map_sum[k] / map_n[k], stops))
    write_png(out_base + ".png", PNG_W, PNG_H, rgba)


def main():
    if len(sys.argv) != 3:
        sys.stderr.write("usage: radar-convert.py <tiles-basename> <output-basename>\n")
        return 1
    ramp = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rain-colorramp.txt")

    # a hard deadline, whatever the files do: the widget's queue must not stall
    def too_long(signum, frame):
        raise Unsupported("the conversion took over %d s" % DEADLINE_SECONDS)
    if hasattr(signal, "SIGALRM"):
        signal.signal(signal.SIGALRM, too_long)
        signal.alarm(DEADLINE_SECONDS)
    try:
        convert(sys.argv[1], sys.argv[2], ramp)
    except Unsupported as e:
        sys.stderr.write("radar-convert: unsupported radar picture: %s\n" % e)
        return 2
    except (OSError, struct.error, IndexError, KeyError, ValueError, TypeError, ZeroDivisionError, zlib.error, MemoryError) as e:
        sys.stderr.write("radar-convert: unreadable radar picture: %s\n" % e)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
