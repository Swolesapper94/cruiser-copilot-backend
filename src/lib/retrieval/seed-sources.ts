import {
  sourceDocumentSchema,
  sourcePassageSchema,
} from "@/lib/validation/schemas";
import { z } from "zod";

/**
 * PLACEHOLDER SOURCE LIBRARY
 * ==========================
 * Cruiser Copilot must never invent a Toyota specification. Until real manual
 * pages and the curated forum thread are imported through services/ingestion,
 * every record here is explicitly marked `isPlaceholder: true` and every
 * specification value is a labelled placeholder token rather than a number.
 *
 * The UI is required to render placeholder records with a visible warning and
 * the diagnostic policy is required to keep specifications locked while any
 * relied-upon record is a placeholder.
 *
 * Replace this file's contents via `python services/ingestion/ingest.py` once
 * licensed source material is available. Do not hand-type specification values.
 */

const rawDocuments = [
  {
    id: "doc-oem-bulletin-acsd",
    sourceType: "service_bulletin",
    title:
      "PLACEHOLDER — Toyota service bulletin record (cold-start advance device)",
    manufacturer: "Toyota",
    documentNumber: "PENDING-IMPORT",
    revision: "PENDING-IMPORT",
    authorityLevel: 1,
    licenseStatus: "unknown",
    isPlaceholder: true,
  },
  {
    id: "doc-oem-repair-manual",
    sourceType: "oem_manual",
    title: "PLACEHOLDER — Toyota repair manual excerpt (fuel / injection pump)",
    manufacturer: "Toyota",
    documentNumber: "PENDING-IMPORT",
    revision: "PENDING-IMPORT",
    authorityLevel: 2,
    licenseStatus: "unknown",
    isPlaceholder: true,
  },
  {
    id: "doc-oem-technical-diesel",
    sourceType: "oem_technical",
    title: "PLACEHOLDER — Toyota diesel technical training material",
    manufacturer: "Toyota",
    documentNumber: "PENDING-IMPORT",
    authorityLevel: 3,
    licenseStatus: "unknown",
    isPlaceholder: true,
  },
  {
    id: "doc-case-hdj80-air-leak",
    sourceType: "verified_case",
    title: "PLACEHOLDER — Verified repair case record (air ingress, HDJ80)",
    authorityLevel: 4,
    licenseStatus: "owned",
    isPlaceholder: true,
  },
  {
    id: "doc-forum-timing-thread",
    sourceType: "forum",
    title:
      "PLACEHOLDER — Curated owner-forum thread on injection-pump timing (import pending)",
    authorityLevel: 6,
    licenseStatus: "unknown",
    isPlaceholder: true,
  },
];

const rawPassages = [
  /* ---------------- OEM procedure scaffolding ---------------- */
  {
    id: "psg-oem-timing-procedure",
    sourceDocumentId: "doc-oem-repair-manual",
    text:
      "PLACEHOLDER OEM PROCEDURE TEXT. The factory procedure for checking injection-pump timing sets the engine to the specified position on the compression stroke, installs a dial indicator into the pump's distributive head plug port, and reads plunger lift against the published specification for the exact vehicle. The measured lift is then compared with the applicable value before any adjustment is made. Verbatim wording, figures, tool numbers and values are withheld until a licensed source is imported.",
    section: "Fuel — injection pump timing inspection",
    modelCodes: ["HDJ80", "HZJ75", "HZJ78"],
    engineCodes: ["1HZ", "1HD-T"],
    markets: [],
    pumpModels: [],
    keywords: [
      "injection pump timing",
      "plunger stroke",
      "plunger lift",
      "dial indicator",
      "tdc",
      "static timing",
    ],
    diagramRef: "placeholder-diagram-pump-timing",
  },
  {
    id: "psg-oem-timing-safety",
    sourceDocumentId: "doc-oem-repair-manual",
    text:
      "PLACEHOLDER OEM SAFETY TEXT. Work on a cold engine. Relieve fuel-system pressure before opening any fuel connection. Support the vehicle on rated stands before any work is performed underneath it. Do not open a hot, pressurised cooling system.",
    section: "Fuel — general precautions",
    modelCodes: ["HDJ80", "HZJ75", "HZJ78"],
    engineCodes: ["1HZ", "1HD-T"],
    markets: [],
    pumpModels: [],
    keywords: ["safety", "precautions", "fuel pressure", "support vehicle"],
  },

  /* ---------------- Competing specification values ---------------- */
  {
    id: "psg-spec-plunger-hdj80-early",
    sourceDocumentId: "doc-oem-repair-manual",
    text:
      "PLACEHOLDER SPECIFICATION RECORD. Plunger stroke at the specified crank position for early-production HDJ80 with 1HD-T. The numeric value is intentionally not stored until a licensed, vehicle-matched source page is imported.",
    section: "Fuel — injection pump specifications",
    pageNumber: 1,
    modelCodes: ["HDJ80"],
    engineCodes: ["1HD-T"],
    markets: [],
    pumpModels: [],
    yearStart: 1990,
    yearEnd: 1993,
    keywords: ["plunger stroke", "specification", "timing value", "1hd-t"],
    specificationSubject: "injection-pump-plunger-stroke-at-tdc",
    specificationValue: "PLACEHOLDER_SPEC_A — value pending verified OEM import",
  },
  {
    id: "psg-spec-plunger-hdj80-late-eu",
    sourceDocumentId: "doc-oem-repair-manual",
    text:
      "PLACEHOLDER SPECIFICATION RECORD. Plunger stroke at the specified crank position for later-production HDJ80 with 1HD-T in emissions-equipped European destination. The numeric value is intentionally not stored until a licensed, vehicle-matched source page is imported.",
    section: "Fuel — injection pump specifications (destination variant)",
    pageNumber: 2,
    modelCodes: ["HDJ80"],
    engineCodes: ["1HD-T"],
    markets: ["EU"],
    pumpModels: [],
    yearStart: 1994,
    yearEnd: 1997,
    keywords: ["plunger stroke", "specification", "timing value", "destination"],
    specificationSubject: "injection-pump-plunger-stroke-at-tdc",
    specificationValue: "PLACEHOLDER_SPEC_B — value pending verified OEM import",
  },
  {
    id: "psg-spec-plunger-forum-claim",
    sourceDocumentId: "doc-forum-timing-thread",
    text:
      "PLACEHOLDER COMMUNITY CLAIM. A forum contributor reports running a different plunger-stroke figure than the factory value and describes the resulting behaviour. Community values are recorded for context only and may never override an applicable factory specification.",
    postNumber: "PENDING-IMPORT",
    modelCodes: ["HDJ80"],
    engineCodes: ["1HD-T"],
    markets: [],
    pumpModels: [],
    keywords: ["plunger stroke", "advanced timing", "community"],
    specificationSubject: "injection-pump-plunger-stroke-at-tdc",
    specificationValue: "PLACEHOLDER_SPEC_C — community claim, unverified",
  },

  /* ---------------- ACSD ---------------- */
  {
    id: "psg-bulletin-acsd",
    sourceDocumentId: "doc-oem-bulletin-acsd",
    text:
      "PLACEHOLDER BULLETIN TEXT. The automatic cold-start device advances pump timing while the engine is cold and returns it as coolant temperature rises. A seized or disabled device changes cold-start behaviour without necessarily affecting warm running. Confirm whether the device is fitted, functional, or has been removed before interpreting cold-start symptoms.",
    modelCodes: ["HDJ80", "HZJ75", "HZJ78"],
    engineCodes: ["1HZ", "1HD-T"],
    markets: [],
    pumpModels: [],
    keywords: ["acsd", "cold start device", "advance", "coolant temperature"],
  },

  /* ---------------- Air ingress ---------------- */
  {
    id: "psg-technical-air-ingress",
    sourceDocumentId: "doc-oem-technical-diesel",
    text:
      "PLACEHOLDER TECHNICAL TEXT. Air drawn into the low-pressure fuel circuit, or fuel draining back to the tank while the engine is stopped, delays the establishment of injection pressure and lengthens cranking after a period of standing. Behaviour that improves after operating the hand primer points toward the supply side rather than the pump's internal timing.",
    modelCodes: ["HDJ80", "HZJ75", "HZJ78"],
    engineCodes: ["1HZ", "1HD-T"],
    markets: [],
    pumpModels: [],
    keywords: ["air ingress", "primer", "fuel drain back", "hard start"],
  },
  {
    id: "psg-case-air-leak",
    sourceDocumentId: "doc-case-hdj80-air-leak",
    text:
      "PLACEHOLDER VERIFIED CASE. Long cranking after standing overnight, resolved by replacing hardened sealing washers on the low-pressure fuel circuit. Cold-start smoke cleared once air ingress was eliminated. Recorded outcome, not a specification.",
    modelCodes: ["HDJ80"],
    engineCodes: ["1HD-T"],
    markets: [],
    pumpModels: [],
    keywords: ["air leak", "sealing washers", "overnight", "hard start"],
  },

  /* ---------------- Glow plugs / compression ---------------- */
  {
    id: "psg-technical-glow",
    sourceDocumentId: "doc-oem-technical-diesel",
    text:
      "PLACEHOLDER TECHNICAL TEXT. Glow-plug system faults typically worsen as ambient temperature falls and improve once the engine is warm. Individual plug resistance and supply voltage are measured before any conclusion is drawn; smoke colour alone does not identify a glow-plug fault.",
    modelCodes: ["HDJ80", "HZJ75", "HZJ78"],
    engineCodes: ["1HZ", "1HD-T"],
    markets: [],
    pumpModels: [],
    keywords: ["glow plug", "cold start", "resistance", "ambient temperature"],
  },
  {
    id: "psg-technical-compression",
    sourceDocumentId: "doc-oem-technical-diesel",
    text:
      "PLACEHOLDER TECHNICAL TEXT. Low cylinder compression lengthens cold cranking and produces incomplete combustion until the engine warms. Compression is measured with the correct adapter and a known-good battery; internal condition cannot be inferred from exhaust appearance.",
    modelCodes: ["HDJ80", "HZJ75", "HZJ78"],
    engineCodes: ["1HZ", "1HD-T"],
    markets: [],
    pumpModels: [],
    keywords: ["compression", "cranking", "cylinder", "cold start"],
  },
  {
    id: "psg-forum-timing-tip",
    sourceDocumentId: "doc-forum-timing-thread",
    text:
      "PLACEHOLDER COMMUNITY TIP. Contributors describe practical access advice for reaching the pump head plug on a fitted engine, including which hoses they move first and how they avoid dropping hardware into the valley. Access advice only — not a Toyota instruction and not a specification.",
    postNumber: "PENDING-IMPORT",
    modelCodes: ["HDJ80", "HZJ75", "HZJ78"],
    engineCodes: ["1HZ", "1HD-T"],
    markets: [],
    pumpModels: [],
    keywords: ["access", "head plug", "tip", "community"],
  },
  {
    id: "psg-forum-air-ingress-tip",
    sourceDocumentId: "doc-forum-timing-thread",
    text:
      "PLACEHOLDER COMMUNITY TIP. Contributors report checking the fuel-filter housing seal and hand-primer assembly before suspecting pump timing, because those parts are cheap and quick to inspect. Practical triage advice only.",
    postNumber: "PENDING-IMPORT",
    modelCodes: ["HDJ80", "HZJ75", "HZJ78"],
    engineCodes: ["1HZ", "1HD-T"],
    markets: [],
    pumpModels: [],
    keywords: ["fuel filter", "primer", "triage", "community"],
  },
];

export const SOURCE_DOCUMENTS = z.array(sourceDocumentSchema).parse(rawDocuments);
export const SOURCE_PASSAGES = z.array(sourcePassageSchema).parse(rawPassages);

export function getSourceDocument(id: string) {
  return SOURCE_DOCUMENTS.find((doc) => doc.id === id);
}

export function getSourcePassage(id: string) {
  return SOURCE_PASSAGES.find((passage) => passage.id === id);
}

/** True while no licensed source material has been imported. */
export const SOURCE_LIBRARY_IS_PLACEHOLDER = SOURCE_DOCUMENTS.every(
  (doc) => doc.isPlaceholder,
);
