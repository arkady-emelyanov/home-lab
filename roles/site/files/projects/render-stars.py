#!/usr/bin/env python3
"""Render a seamless star-field tile, transparent between the stars.

    render-stars.py static/stars.webp [--size 1024] [--count 1500] [--seed 3]

The page's background, repeated. Not run at converge: the image is committed beside
it, and this is how it was made. Needs numpy and Pillow, which nothing else here does.

Brightness follows a steep power law, so most stars are barely-there points and a
handful carry a small halo. Halos wrap at the edges, so the tile repeats without seams.
"""

import argparse

import numpy as np
from PIL import Image


def render(size, count, seed):
    rng = np.random.default_rng(seed)
    light = np.zeros((size, size))
    colour = np.zeros((size, size, 3))

    xs = rng.random(count) * size
    ys = rng.random(count) * size
    mag = rng.random(count) ** 9                       # most faint, very few bright
    # star colours: mostly white, some blue-white, a few warm
    tint = rng.choice(3, count, p=[0.62, 0.28, 0.10])
    palette = np.array([[1.0, 1.0, 1.0], [0.78, 0.86, 1.0], [1.0, 0.88, 0.74]])

    yy, xx = np.mgrid[-6:7, -6:7]
    for x, y, m, t in zip(xs, ys, mag, tint):
        sigma = 0.42 + 0.8 * m                          # bright stars spread a little
        ox, oy = x - np.floor(x), y - np.floor(y)
        k = np.exp(-((xx - ox + 0.5) ** 2 + (yy - oy + 0.5) ** 2) / (2 * sigma ** 2))
        k *= 0.10 + 0.42 * m
        # a faint wide halo on the brightest few
        if m > 0.5:
            k += 0.025 * m * np.exp(-((xx - ox) ** 2 + (yy - oy) ** 2) / (2 * 4.0 ** 2))
        cx, cy = int(x), int(y)
        rows = (cy + yy) % size
        cols = (cx + xx) % size
        light[rows, cols] += k
        colour[rows, cols] += k[..., None] * palette[t]

    alpha = np.clip(light, 0, 1)
    rgb = colour / np.maximum(light[..., None], 1e-6)
    out = np.dstack([np.clip(rgb, 0, 1), alpha])
    return (out * 255).astype(np.uint8)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--size", type=int, default=1024)
    ap.add_argument("--count", type=int, default=1500)
    ap.add_argument("--seed", type=int, default=3)
    a = ap.parse_args()
    Image.fromarray(render(a.size, a.count, a.seed), "RGBA").save(a.out, lossless=True, method=6)


if __name__ == "__main__":
    main()
