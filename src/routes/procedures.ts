import { Router } from "express";
import { API_CONTRACT_VERSION } from "@/lib/api/contract";
import { bearerToken, errorResult } from "@/lib/api/handlers";
import { evaluateSession } from "@/lib/diagnostic-policy";
import { getProcedure } from "@/lib/procedures";
import { citationsForPassageIds } from "@/lib/retrieval";
import { sessionStore } from "@/lib/store";

export const proceduresRouter = Router();

proceduresRouter.get("/:id", async (req, res) => {
  const procedure = getProcedure(req.params.id);
  if (!procedure) {
    const result = errorResult(404, "procedure_not_found");
    res.status(result.status).json(result.body);
    return;
  }

  const passageIds = Array.from(
    new Set(
      procedure.steps.flatMap((step) =>
        step.citationIds.map((citationId) => citationId.replace(/^cit-/, "")),
      ),
    ),
  );

  const sessionId = typeof req.query.sessionId === "string" ? req.query.sessionId : undefined;
  const session = sessionId
    ? await sessionStore.authorize(
        sessionId,
        bearerToken(req.header("authorization")),
      )
    : undefined;
  if (sessionId && !session) {
    const result = errorResult(404, "session_not_found");
    res.status(result.status).json(result.body);
    return;
  }
  const update = session ? evaluateSession(session) : undefined;

  res.json({
    contractVersion: API_CONTRACT_VERSION,
    procedure,
    citations: citationsForPassageIds(passageIds),
    specificationLocked: update?.specificationLocked ?? true,
    safetyGates: update?.safetyGates ?? [],
    completedStepIds: session?.completedStepIds ?? [],
  });
});
