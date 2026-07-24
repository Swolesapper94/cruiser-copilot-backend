"""
Cruiser Copilot — source ingestion CLI.

Imports documents *you are licensed to use* into a local passage store.

This tool deliberately does very little automatically:

  * It never guesses applicability. A passage without model codes, engine codes,
    markets, pump models or a year range is stored as context only and can never
    resolve a specification conflict.
  * It never extracts a specification value on its own. You mark a passage as
    carrying a specification explicitly, with the subject and the value, because
    a mis-scraped tolerance is worse than no tolerance.
  * It writes nothing outside the output path you give it.

Usage
-----
    python ingest.py plan   --input manual.pdf --out plan.json
    python ingest.py import --plan plan.json --metadata doc.json --out store.json
    python ingest.py verify --store store.json

See README.md.
"""

from __future__ import annotations

import argparse
import dataclasses
import hashlib
import json
import pathlib
import re
import sys
from typing import Any, Iterable

AUTHORITY_BY_SOURCE_TYPE: dict[str, int] = {
    "service_bulletin": 1,
    "oem_manual": 2,
    "oem_technical": 3,
    "verified_case": 4,
    "technician": 5,
    "forum": 6,
    "general": 7,
}

OEM_SOURCE_TYPES = {"service_bulletin", "oem_manual", "oem_technical"}

LICENSE_STATUSES = {"licensed", "user-supplied", "public", "unknown"}

APPLICABILITY_KEYS = (
    "modelCodes",
    "engineCodes",
    "markets",
    "pumpModels",
)


class IngestionError(RuntimeError):
    """Raised for anything that would produce an untrustworthy record."""


# ---------------------------------------------------------------------------
# Text extraction
# ---------------------------------------------------------------------------


def read_pages(path: pathlib.Path) -> list[tuple[int, str]]:
    """Returns (page_number, text) pairs. Plain text files are a single page."""
    if path.suffix.lower() == ".pdf":
        try:
            from pypdf import PdfReader
        except ImportError as exc:  # pragma: no cover - environment dependent
            raise IngestionError(
                "Reading PDFs requires pypdf. Install it with "
                "`pip install -r requirements.txt`."
            ) from exc

        reader = PdfReader(str(path))
        return [
            (index + 1, (page.extract_text() or "").strip())
            for index, page in enumerate(reader.pages)
        ]

    return [(1, path.read_text(encoding="utf-8", errors="replace"))]


PARAGRAPH_SPLIT = re.compile(r"\n\s*\n")


def chunk_page(text: str, max_chars: int = 1200) -> list[str]:
    """Paragraph-first chunking. Never splits mid-sentence when avoidable."""
    chunks: list[str] = []
    buffer = ""

    for paragraph in PARAGRAPH_SPLIT.split(text):
        cleaned = " ".join(paragraph.split())
        if not cleaned:
            continue
        if len(buffer) + len(cleaned) + 1 <= max_chars:
            buffer = f"{buffer} {cleaned}".strip()
            continue
        if buffer:
            chunks.append(buffer)
        while len(cleaned) > max_chars:
            cut = cleaned.rfind(". ", 0, max_chars)
            cut = cut + 1 if cut > max_chars // 2 else max_chars
            chunks.append(cleaned[:cut].strip())
            cleaned = cleaned[cut:].strip()
        buffer = cleaned

    if buffer:
        chunks.append(buffer)
    return chunks


# ---------------------------------------------------------------------------
# Plan
# ---------------------------------------------------------------------------


@dataclasses.dataclass
class PlannedPassage:
    id: str
    text: str
    pageNumber: int | None
    section: str | None = None
    modelCodes: list[str] = dataclasses.field(default_factory=list)
    engineCodes: list[str] = dataclasses.field(default_factory=list)
    markets: list[str] = dataclasses.field(default_factory=list)
    pumpModels: list[str] = dataclasses.field(default_factory=list)
    yearStart: int | None = None
    yearEnd: int | None = None
    keywords: list[str] = dataclasses.field(default_factory=list)
    specificationSubject: str | None = None
    specificationValue: str | None = None


def stable_id(prefix: str, *parts: str) -> str:
    digest = hashlib.sha1("::".join(parts).encode("utf-8")).hexdigest()[:12]
    return f"{prefix}-{digest}"


def build_plan(input_path: pathlib.Path) -> dict[str, Any]:
    passages: list[PlannedPassage] = []
    for page_number, page_text in read_pages(input_path):
        for chunk in chunk_page(page_text):
            passages.append(
                PlannedPassage(
                    id=stable_id("psg", input_path.name, str(page_number), chunk[:80]),
                    text=chunk,
                    pageNumber=page_number,
                )
            )

    return {
        "sourceFile": input_path.name,
        "note": (
            "Fill in applicability for every passage you intend to rely on. "
            "Passages left without applicability metadata are stored as context "
            "only and can never resolve a specification conflict. Set "
            "specificationSubject and specificationValue ONLY where you have "
            "read the value directly from this source."
        ),
        "passages": [dataclasses.asdict(passage) for passage in passages],
    }


# ---------------------------------------------------------------------------
# Import
# ---------------------------------------------------------------------------


def validate_metadata(metadata: dict[str, Any]) -> dict[str, Any]:
    required = ("id", "title", "sourceType", "licenseStatus")
    missing = [key for key in required if not metadata.get(key)]
    if missing:
        raise IngestionError(f"Document metadata is missing: {', '.join(missing)}")

    source_type = metadata["sourceType"]
    if source_type not in AUTHORITY_BY_SOURCE_TYPE:
        raise IngestionError(
            f"Unknown sourceType {source_type!r}. "
            f"Expected one of: {', '.join(sorted(AUTHORITY_BY_SOURCE_TYPE))}"
        )

    if metadata["licenseStatus"] not in LICENSE_STATUSES:
        raise IngestionError(
            f"Unknown licenseStatus {metadata['licenseStatus']!r}. "
            f"Expected one of: {', '.join(sorted(LICENSE_STATUSES))}"
        )

    if source_type in OEM_SOURCE_TYPES and metadata["licenseStatus"] == "unknown":
        raise IngestionError(
            "Refusing to import OEM material with an unknown licence status. "
            "Set licenseStatus explicitly."
        )

    metadata = dict(metadata)
    metadata["authorityLevel"] = AUTHORITY_BY_SOURCE_TYPE[source_type]
    # A record only stops being a placeholder once a human has confirmed it.
    metadata.setdefault("isPlaceholder", False)
    return metadata


def has_applicability(passage: dict[str, Any]) -> bool:
    if any(passage.get(key) for key in APPLICABILITY_KEYS):
        return True
    return passage.get("yearStart") is not None or passage.get("yearEnd") is not None


def validate_passages(passages: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    validated: list[dict[str, Any]] = []
    for passage in passages:
        if not passage.get("id") or not passage.get("text"):
            raise IngestionError("Every passage needs an id and text.")

        subject = passage.get("specificationSubject")
        value = passage.get("specificationValue")
        if bool(subject) != bool(value):
            raise IngestionError(
                f"Passage {passage['id']}: specificationSubject and "
                "specificationValue must be provided together."
            )

        if subject and not has_applicability(passage):
            raise IngestionError(
                f"Passage {passage['id']} carries a specification value but has no "
                "applicability metadata. A specification without applicability is "
                "unusable and dangerous. Add model codes, engine codes, markets, "
                "pump models or a year range."
            )

        validated.append(passage)
    return validated


def run_import(
    plan_path: pathlib.Path,
    metadata_path: pathlib.Path,
    out_path: pathlib.Path,
) -> dict[str, Any]:
    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    metadata = validate_metadata(json.loads(metadata_path.read_text(encoding="utf-8")))
    passages = validate_passages(plan.get("passages", []))

    for passage in passages:
        passage["sourceDocumentId"] = metadata["id"]

    store: dict[str, Any] = {"documents": [], "passages": []}
    if out_path.exists():
        store = json.loads(out_path.read_text(encoding="utf-8"))

    store["documents"] = [
        doc for doc in store.get("documents", []) if doc["id"] != metadata["id"]
    ] + [metadata]
    store["passages"] = [
        psg
        for psg in store.get("passages", [])
        if psg.get("sourceDocumentId") != metadata["id"]
    ] + passages

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(store, indent=2, ensure_ascii=False), encoding="utf-8")
    return store


# ---------------------------------------------------------------------------
# Verify
# ---------------------------------------------------------------------------


def run_verify(store_path: pathlib.Path) -> int:
    store = json.loads(store_path.read_text(encoding="utf-8"))
    documents = {doc["id"]: doc for doc in store.get("documents", [])}
    passages = store.get("passages", [])

    problems: list[str] = []
    context_only = 0
    spec_bearing = 0

    for passage in passages:
        document_id = passage.get("sourceDocumentId")
        if document_id not in documents:
            problems.append(f"{passage.get('id')}: unknown sourceDocumentId {document_id}")
            continue
        if passage.get("specificationSubject"):
            spec_bearing += 1
        if not has_applicability(passage):
            context_only += 1

    by_subject: dict[str, set[str]] = {}
    for passage in passages:
        subject = passage.get("specificationSubject")
        if not subject:
            continue
        by_subject.setdefault(subject, set()).add(str(passage.get("specificationValue")))

    print(f"documents        : {len(documents)}")
    print(f"passages         : {len(passages)}")
    print(f"specification    : {spec_bearing}")
    print(f"context only     : {context_only}")

    for subject, values in sorted(by_subject.items()):
        if len(values) > 1:
            print(
                f"conflict         : {subject} has {len(values)} distinct values. "
                "The app will surface this rather than pick one."
            )

    for problem in problems:
        print(f"PROBLEM          : {problem}", file=sys.stderr)

    return 1 if problems else 0


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    sub = parser.add_subparsers(dest="command", required=True)

    plan_cmd = sub.add_parser("plan", help="Chunk a document into a reviewable plan")
    plan_cmd.add_argument("--input", required=True, type=pathlib.Path)
    plan_cmd.add_argument("--out", required=True, type=pathlib.Path)

    import_cmd = sub.add_parser("import", help="Import a reviewed plan into the store")
    import_cmd.add_argument("--plan", required=True, type=pathlib.Path)
    import_cmd.add_argument("--metadata", required=True, type=pathlib.Path)
    import_cmd.add_argument("--out", required=True, type=pathlib.Path)

    verify_cmd = sub.add_parser("verify", help="Report on an existing store")
    verify_cmd.add_argument("--store", required=True, type=pathlib.Path)

    args = parser.parse_args(argv)

    try:
        if args.command == "plan":
            plan = build_plan(args.input)
            args.out.parent.mkdir(parents=True, exist_ok=True)
            args.out.write_text(
                json.dumps(plan, indent=2, ensure_ascii=False), encoding="utf-8"
            )
            print(
                f"Wrote {len(plan['passages'])} draft passages to {args.out}. "
                "Review and add applicability before importing."
            )
            return 0

        if args.command == "import":
            store = run_import(args.plan, args.metadata, args.out)
            print(
                f"Store now holds {len(store['documents'])} documents and "
                f"{len(store['passages'])} passages."
            )
            return 0

        return run_verify(args.store)

    except IngestionError as error:
        print(f"error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
