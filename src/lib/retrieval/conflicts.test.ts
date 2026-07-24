import { describe, expect, it } from "vitest";
import {
  authorityFor,
  isOemSource,
  mayOverrideSpecification,
} from "./authority";
import { retrieve, specificationIsLocked } from "./index";
import { SOURCE_LIBRARY_IS_PLACEHOLDER } from "./seed-sources";
import type { Vehicle } from "@/types";

const SUBJECT = "injection-pump-plunger-stroke-at-tdc";

const partiallyKnown: Vehicle = {
  id: "veh-partial",
  series: "80",
  engineCode: "1HD-T",
  modifications: [],
  identificationConfidence: "user-confirmed",
};

describe("authority ordering", () => {
  it("ranks a service bulletin above a repair manual above a forum post", () => {
    expect(authorityFor("service_bulletin")).toBeLessThan(authorityFor("oem_manual"));
    expect(authorityFor("oem_manual")).toBeLessThan(authorityFor("forum"));
  });

  it("classifies OEM sources explicitly", () => {
    expect(isOemSource("oem_manual")).toBe(true);
    expect(isOemSource("forum")).toBe(false);
    expect(isOemSource("verified_case")).toBe(false);
  });

  it("never lets community content override an OEM specification", () => {
    expect(
      mayOverrideSpecification(
        { authorityLevel: authorityFor("forum") },
        { authorityLevel: authorityFor("oem_manual") },
      ),
    ).toBe(false);
    expect(
      mayOverrideSpecification(
        { authorityLevel: authorityFor("technician") },
        { authorityLevel: authorityFor("oem_technical") },
      ),
    ).toBe(false);
    expect(
      mayOverrideSpecification(
        { authorityLevel: authorityFor("service_bulletin") },
        { authorityLevel: authorityFor("oem_manual") },
      ),
    ).toBe(true);
  });
});

describe("retrieve", () => {
  it("reports the source library as placeholder-only until licensed imports exist", () => {
    expect(SOURCE_LIBRARY_IS_PLACEHOLDER).toBe(true);
    const result = retrieve({ vehicle: partiallyKnown, specificationSubject: SUBJECT });
    expect(result.placeholderOnly).toBe(true);
  });

  it("detects competing specification values and leaves them unresolved", () => {
    const result = retrieve({ vehicle: partiallyKnown, specificationSubject: SUBJECT });
    const conflict = result.conflicts.find((entry) => entry.subject === SUBJECT);

    expect(conflict).toBeDefined();
    expect(conflict!.alternatives.length).toBeGreaterThanOrEqual(2);
    expect(conflict!.resolutionStatus).toBe("unresolved");
    expect(conflict!.missingApplicabilityFields).toContain("productionYear");
    expect(specificationIsLocked(result.conflicts)).toBe(true);
  });

  it("orders retrieved passages by score and then by authority", () => {
    const result = retrieve({
      vehicle: partiallyKnown,
      keywords: ["injection timing"],
      specificationSubject: SUBJECT,
    });

    expect(result.passages.length).toBeGreaterThan(0);
    for (let index = 1; index < result.passages.length; index += 1) {
      const previous = result.passages[index - 1];
      const current = result.passages[index];
      if (previous.score === current.score) {
        expect(previous.document.authorityLevel).toBeLessThanOrEqual(
          current.document.authorityLevel,
        );
      } else {
        expect(previous.score).toBeGreaterThan(current.score);
      }
    }
  });

  it("excludes passages that positively contradict the vehicle", () => {
    const result = retrieve({
      vehicle: {
        ...partiallyKnown,
        modelCode: "HDJ80",
        market: "EU",
        productionYear: 1991,
      },
      specificationSubject: SUBJECT,
    });

    const values = result.passages
      .map((entry) => entry.passage.specificationValue)
      .filter(Boolean);
    expect(values).not.toContain("PLACEHOLDER_SPEC_B — value pending verified OEM import");
  });
});
