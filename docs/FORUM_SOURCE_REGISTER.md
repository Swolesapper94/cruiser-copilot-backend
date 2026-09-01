# Forum source register

**Review date:** 2026-09-01
**Scope:** public 70/80 Series and 1HZ/1HD-T diagnostic discussions
**Current authorization:** no source is active

This register separates “technically useful” from “authorized to ingest.” A
robots rule controls automated access; it does not grant copyright or reuse
rights. The runtime registry in `src/lib/evidence/source-registry.ts` is the
enforced source allow-list.

## Recommended order

| Order | Source | Why it is useful | Current policy result | Next decision |
| --- | --- | --- | --- | --- |
| 1 | [Land Cruiser Club](https://www.landcruiserclub.net/community/forums/) | Land Cruiser-only community with 70/80 Series and strong diesel-market coverage; supported XenForo structure | Thread paths are allowed by [robots.txt](https://www.landcruiserclub.net/robots.txt), but the forum terms do not clearly grant third-party indexing/RAG reuse | Ask the operator for a small, attributed, text-only pilot or document another reviewed lawful basis |
| 2 | [IH8MUD](https://forum.ih8mud.com/) | By far the largest Cruiser corpus, with dedicated 70 Series, 80 Series, and Diesel Tech sections | [Terms](https://www.ih8mud.com/privacy-terms-conditions/) prohibit gathering data or commercial use without express written consent; `robots.txt` alone allows thread paths | Request written permission from Tie Rod Media; do not crawl before it is granted |
| 3 | [Expedition Portal](https://forum.expeditionportal.com/) | Useful outcome-rich overland repair cases and a dedicated Toyota/Land Cruiser area | Thread paths are allowed by [robots.txt](https://forum.expeditionportal.com/robots.txt); [terms](https://forum.expeditionportal.com/help/terms/) say authors retain copyright and grant a licence to the forum, not to us | Defer until the two focused communities are resolved; then seek operator approval |
| 4 | [Toyota Owners Club Australia](https://au.toyotaownersclub.com/forums/) | Directly relevant Australian 1HD-T cases | [robots.txt](https://au.toyotaownersclub.com/robots.txt) permits search/reference use and forbids AI training, while blocking named AI bots; [terms](https://au.toyotaownersclub.com/terms-conditions/) do not grant broad reuse. The current parser also does not support Invision | Keep restricted; define a short-excerpt policy and build an Invision adapter only after policy approval |

## Pilot shape

Once one source is approved, keep the first run deliberately small:

1. Ten manually selected, public technical threads; no login, classifieds,
   member profiles, private messages, attachments, or media downloads.
2. Only 70/80 Series threads mentioning `1HZ`, `1HD-T`, `1HDT`, cold start,
   injection pump, smoke, overheating, fuel delivery, or a documented repair
   outcome.
3. One request at a time with the source-specific 10–12 second delay and a
   descriptive contact-bearing user agent.
4. Store source URL, post boundaries, timestamps, content hash, and text needed
   for citation. Keep images as links with unknown rights.
5. Human-review every extracted document before it can enter live retrieval.
6. Evaluate parser coverage, duplicate rate, citation precision, applicability
   extraction, outcome precision, and removal handling before adding volume.

## Source admission checklist

A registry entry may change to `active: true` only in a reviewed change that
records all of the following:

- current terms URL, decision, reviewer, and review date;
- current robots URL and review date;
- permitted paths, excluded areas, purpose, retention, excerpt, and deletion
  policy;
- any operator permission or API/feed conditions;
- adapter fixture tests proving post, quote, author, time, pagination, and text
  coverage;
- rate, page, byte, retry, and user-agent limits;
- a named owner for takedown and source-policy changes.

The environment flag cannot bypass this checklist. `pending`, `restricted`, and
`prohibited` sources remain non-runnable even when forum ingestion is enabled.

## Not shortlisted

- LCOOL was not added because current community reports indicate the historic
  forum is no longer a dependable live source.
- Tapatalk mirrors and broad off-road forums are lower-value until the focused
  sources prove the extraction and review workflow.
- Search-engine snippets may help discover candidate URLs, but are not source
  documents and must never be indexed as evidence.
