import { Router, type Response } from "express";
import {
  buildPayload,
  errorResult,
  mutateSession,
  parseBody,
  withSession,
  type ApiResult,
} from "@/lib/api/handlers";
import { mediaAnalysisAvailable, uploadLimits } from "@/lib/config/env";
import { questionById } from "@/lib/diagnostic-policy";
import { seriesForModelCode } from "@/lib/retrieval";
import { createId, newSession, sessionStore } from "@/lib/store";
import {
  createSessionRequestSchema,
  patchVehicleRequestSchema,
  postAnswerRequestSchema,
  postEvidenceRequestSchema,
  postOutcomeRequestSchema,
  postStepRequestSchema,
} from "@/lib/validation/schemas";
import type { EvidenceItem } from "@/types";

export const sessionsRouter = Router();

const MEDIA_TYPES = new Set(["photo", "video", "audio"]);

function send(res: Response, result: ApiResult) {
  res.status(result.status).json(result.body);
}

function stripUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Partial<T>;
}

sessionsRouter.post("/", async (req, res) => {
  const parsed = parseBody(createSessionRequestSchema, req.body);
  if (!parsed.ok) return send(res, parsed.result);

  const session = newSession(createId("ses"), parsed.data.complaint ?? "");
  await sessionStore.create(session);

  res.status(201).json(await buildPayload(session));
});

sessionsRouter.get("/:id", async (req, res) => {
  const result = await withSession(req.params.id, async (session) => ({
    status: 200,
    body: await buildPayload(session),
  }));
  send(res, result);
});

sessionsRouter.delete("/:id", async (req, res) => {
  const deleted = await sessionStore.delete(req.params.id);
  if (!deleted) return send(res, errorResult(404, "session_not_found"));
  res.status(204).end();
});

sessionsRouter.patch("/:id/vehicle", async (req, res) => {
  const parsed = parseBody(patchVehicleRequestSchema, req.body);
  if (!parsed.ok) return send(res, parsed.result);

  const patch = parsed.data;

  const result = await mutateSession(req.params.id, (session) => {
    const merged = { ...session.vehicle, ...stripUndefined(patch) };

    // A model code implies its series. Inferred values are labelled as such.
    const inferredSeries = merged.modelCode
      ? seriesForModelCode(merged.modelCode)
      : undefined;
    if (merged.series === "unknown" && inferredSeries) {
      merged.series = inferredSeries;
    }

    const userSuppliedIdentity =
      patch.series !== undefined || patch.engineCode !== undefined;

    return {
      ...session,
      vehicle: {
        ...merged,
        identificationConfidence: userSuppliedIdentity
          ? "user-confirmed"
          : merged.identificationConfidence,
      },
    };
  });
  send(res, result);
});

sessionsRouter.post("/:id/answers", async (req, res) => {
  const parsed = parseBody(postAnswerRequestSchema, req.body);
  if (!parsed.ok) return send(res, parsed.result);

  const question = questionById(parsed.data.questionId);
  if (!question) return send(res, errorResult(422, "unknown_question"));

  const allowed = question.options.map((option) => option.value);
  if (allowed.length > 0 && !allowed.includes(parsed.data.value)) {
    return send(res, errorResult(422, "invalid_answer_value"));
  }

  const result = await mutateSession(req.params.id, (session) => ({
    ...session,
    answers: [
      ...session.answers.filter(
        (answer) => answer.questionId !== parsed.data.questionId,
      ),
      {
        questionId: parsed.data.questionId,
        value: parsed.data.value,
        freeText: parsed.data.freeText,
        answeredAt: new Date().toISOString(),
      },
    ],
  }));
  send(res, result);
});

sessionsRouter.post("/:id/evidence", async (req, res) => {
  const parsed = parseBody(postEvidenceRequestSchema, req.body);
  if (!parsed.ok) return send(res, parsed.result);

  const body = parsed.data;
  const isMedia = MEDIA_TYPES.has(body.type);

  if (isMedia) {
    if (body.sizeBytes && body.sizeBytes > uploadLimits.maxUploadBytes) {
      return send(res, errorResult(413, "file_too_large"));
    }
    if (body.mimeType && !uploadLimits.allowedMimeTypes.includes(body.mimeType)) {
      return send(res, errorResult(415, "unsupported_media_type"));
    }
  }

  if (body.type === "measurement" && !body.measurement) {
    return send(res, errorResult(422, "measurement_required"));
  }

  // Media is only ever described, never diagnosed, and only when the owner
  // explicitly opted in and a vision model is actually configured.
  const analysisPermitted =
    isMedia && body.allowModelAnalysis && mediaAnalysisAvailable();

  const item: EvidenceItem = {
    id: createId("evd"),
    type: body.type,
    userDescription: body.userDescription,
    machineObservation: undefined,
    observationLimit: isMedia
      ? "Media can show colour, location and behaviour. It cannot establish an internal mechanical cause."
      : undefined,
    captureConditions: {
      engineTemperature: body.captureConditions?.engineTemperature ?? "unknown",
      timing: body.captureConditions?.timing,
      relationToRepair: body.captureConditions?.relationToRepair ?? "unknown",
    },
    provenance: "user",
    fileName: body.fileName,
    mimeType: body.mimeType,
    sizeBytes: body.sizeBytes,
    createdAt: new Date().toISOString(),
    measurement: body.measurement,
  };

  if (analysisPermitted) {
    item.machineObservation =
      "Model observation was permitted but no media payload was transmitted in this request.";
  }

  const result = await mutateSession(req.params.id, (session) => ({
    ...session,
    evidence: [...session.evidence, item],
  }));
  send(res, result);
});

sessionsRouter.post("/:id/analyze", async (req, res) => {
  const result = await withSession(req.params.id, async (session) => ({
    status: 200,
    body: await buildPayload(session, { explain: true }),
  }));
  send(res, result);
});

sessionsRouter.post("/:id/steps", async (req, res) => {
  const parsed = parseBody(postStepRequestSchema, req.body);
  if (!parsed.ok) return send(res, parsed.result);

  const { stepId, completed } = parsed.data;

  const result = await mutateSession(req.params.id, (session) => ({
    ...session,
    completedStepIds: completed
      ? Array.from(new Set([...session.completedStepIds, stepId]))
      : session.completedStepIds.filter((value) => value !== stepId),
  }));
  send(res, result);
});

sessionsRouter.post("/:id/outcome", async (req, res) => {
  const parsed = parseBody(postOutcomeRequestSchema, req.body);
  if (!parsed.ok) return send(res, parsed.result);

  const body = parsed.data;

  const result = await mutateSession(req.params.id, (session) => ({
    ...session,
    outcome: {
      resolved: body.resolved,
      performedTestIds: body.performedTestIds ?? [],
      notes: body.notes,
      recordedAt: new Date().toISOString(),
    },
  }));
  send(res, result);
});
