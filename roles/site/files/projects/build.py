#!/usr/bin/env python3
"""Compile content/ into a single static page.

    build.py OUT --home URL --projects URL --github URL --linkedin URL [--blog URL] [--beacon HOST]

The links come from the role rather than from content/, so no domain is written here.
--beacon adds GoatCounter's page-view script, served from that host; without it
the page has no script at all, which is what a local preview wants. --blog is
where a project's `post` is found; without it, posts are not linked.

content/index.md          front matter for the page, body for the one-line intro
content/projects/*.md     one project each: front matter for title, group, stack and repo,
                          and optionally post, a post that introduces it: a path on the
                          blog, or a full URL for one published elsewhere;
                          body for the essence
templates/*.html          string.Template pages
templates/llms.txt        string.Template for llms.txt; the project list is filled in
static/                   copied as is
"""

import argparse
import hashlib
import html
import re
import shutil
import sys
from pathlib import Path
from urllib.parse import urlsplit
from string import Template

import markdown

ROOT = Path(__file__).resolve().parent
EXTENSIONS = ["smarty"]


def parse(path):
    """Front matter (flat `key: value` lines between --- fences) and the markdown body."""
    text = path.read_text()
    meta = {}
    if text.startswith("---\n"):
        head, text = text[4:].split("\n---\n", 1)
        for line in head.splitlines():
            if line.strip() and not line.lstrip().startswith("#"):
                key, _, value = line.partition(":")
                meta[key.strip()] = value.strip()
    return meta, text


def render(text):
    return markdown.markdown(text, extensions=EXTENSIONS, output_format="html")


def page(template_name, **values):
    template = Template((ROOT / "templates" / f"{template_name}.html").read_text())
    return template.substitute(**values)


def fingerprint(out):
    """Add `?v=<content hash>` to every reference to a top-level static file.

    Cloudflare keeps CSS and images at its edge for hours but does not cache the
    HTML, so a changed stylesheet under an unchanged URL is served stale while
    the page that links it is fresh. A URL that changes with the content is one
    no cache has seen. Images first, since the stylesheet names them and its own
    hash has to cover the rewritten references.
    """
    def digest(path):
        return hashlib.sha256(path.read_bytes()).hexdigest()[:10]

    def rewrite(path, versions):
        text = path.read_text()
        for name, version in versions.items():
            text = text.replace(f'"{name}"', f'"{name}?v={version}"')
        path.write_text(text)

    files = [p for p in out.iterdir() if p.is_file() and p.name != "index.html"]
    versions = {p.name: digest(p) for p in files if p.suffix != ".css"}
    for css in (p for p in files if p.suffix == ".css"):
        rewrite(css, versions)
        versions[css.name] = digest(css)
    rewrite(out / "index.html", versions)


def post_url(meta, blog):
    """The post that introduces the project: a full URL as it is, a path on the blog if
    the blog is known, or None."""
    post = meta.get("post")
    if post and urlsplit(post).scheme:
        return post
    return blog.rstrip("/") + "/" + post.strip("/") + "/" if blog and post else None


# The Medium mark (Simple Icons), for a post published there.
MEDIUM = ('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.54 12a6.8 6.8 0 0 1-6.77 6.82A6.8 6.8 0 0 1 0 12a6.8 6.8 0 0 1 '
          '6.77-6.82A6.8 6.8 0 0 1 13.54 12zm7.42 0c0 3.54-1.51 6.42-3.38 6.42-1.87 0-3.39-2.88-3.39-6.42s1.52-6.42 3.39-6.42 '
          '3.38 2.88 3.38 6.42M24 12c0 3.17-.53 5.75-1.19 5.75-.66 0-1.19-2.58-1.19-5.75s.53-5.75 1.19-5.75C23.47 6.25 24 8.83 24 12z"/></svg>')


def post_link(meta, blog):
    """The link to that post, set beside the title, or nothing."""
    url = post_url(meta, blog)
    if not url:
        return ""
    on_medium = (urlsplit(url).hostname or "").endswith("medium.com")
    label = f"{MEDIUM}Read on Medium" if on_medium else "Read the introduction"
    return f'<a class="post" href="{html.escape(url)}">{label}</a>'


def llms_entry(meta, body, blog):
    """One `- [title](repo): note` line: the essence on a single line, then the stack."""
    # Plain text: markup a content file uses for the page, keycaps say, is noise here.
    essence = " ".join(re.sub(r"<[^>]+>", "", body).split())
    stack = ", ".join(part.strip() for part in meta["stack"].split("·"))
    post = post_url(meta, blog)
    return f"- [{meta['title']}]({meta['repo']}): {essence} Stack: {stack}." + (f" Introduction: {post}" if post else "")


def main():
    args = argparse.ArgumentParser()
    args.add_argument("out", type=Path)
    args.add_argument("--home", required=True)
    args.add_argument("--projects", required=True)
    args.add_argument("--github", required=True)
    args.add_argument("--linkedin", required=True)
    args.add_argument("--blog")
    args.add_argument("--beacon")
    args = args.parse_args()
    out = args.out

    site, intro = parse(ROOT / "content" / "index.md")
    projects = [parse(path) for path in sorted((ROOT / "content" / "projects").glob("*.md"))]
    groups = [g.strip() for g in site["groups"].split(",")]

    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(ROOT / "static", out)

    sections = []
    for number, group in enumerate(groups):
        items = [
            page(
                "project",
                title=html.escape(meta["title"]),
                repo=meta["repo"],
                essence=render(body),
                post=post_link(meta, args.blog),
                stack=html.escape(meta["stack"]),
            )
            for meta, body in projects
            if meta["group"] == group
        ]
        sections.append(page(
            "section",
            numeral=f"{number + 1:02d}",
            name=html.escape(group),
            projects="\n".join(items),
        ))

    (out / "index.html").write_text(page(
        "index",
        site_title=site["title"],
        author=site["author"],
        description=html.escape(site["description"]),
        home=args.home,
        home_name=html.escape(urlsplit(args.home).netloc),
        links=page("links", github=args.github, linkedin=args.linkedin),
        counter=(
            f'<script data-goatcounter="https://{args.beacon}/goatcounter/count" async '
            f'src="https://{args.beacon}/goatcounter/count.js"></script>\n'
            if args.beacon else ""
        ),
        intro=render(intro),
        sections="\n".join(sections),
    ))

    fingerprint(out)

    # The same projects, in the same order, as a list for language models. Built
    # here rather than written by hand so the two cannot disagree.
    template = Template((ROOT / "templates" / "llms.txt").read_text())
    (out / "llms.txt").write_text(template.substitute(
        home=args.home,
        projects_url=args.projects,
        github=args.github,
        linkedin=args.linkedin,
        projects="\n".join(
            llms_entry(meta, body, args.blog)
            for group in groups
            for meta, body in projects
            if meta["group"] == group
        ),
    ))

    print(f"built {len(projects)} projects into {out}", file=sys.stderr)


if __name__ == "__main__":
    main()
