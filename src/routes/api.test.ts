import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

import { API_CONTRACT_VERSION } from "@/lib/api/contract";
import { sessionStore } from "@/lib/store";
import { createApp } from "@/server";

const app = createApp();

async function createSession() {
  const response = await request(app)
    .post("/api/sessions")
    .send({ complaint: "Hard starting when cold" })
    .expect(201);
  return {
    id: response.body.session.id as string,
    token: response.body.sessionAccessToken as string,
    response,
  };
}

describe("HTTP API boundaries", () => {
  beforeEach(async () => {
    await sessionStore.clear();
  });

  it("returns a private token once and requires it for session access", async () => {
    const created = await createSession();
    expect(created.response.body.contractVersion).toBe(API_CONTRACT_VERSION);
    expect(created.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);

    await request(app).get(`/api/sessions/${created.id}`).expect(404);

    const authorized = await request(app)
      .get(`/api/sessions/${created.id}`)
      .set("authorization", `Bearer ${created.token}`)
      .expect(200);
    expect(authorized.body.sessionAccessToken).toBeUndefined();
  });

  it("enforces the supported vehicle scope at the API boundary", async () => {
    const created = await createSession();
    const auth = { authorization: `Bearer ${created.token}` };

    await request(app)
      .patch(`/api/sessions/${created.id}/vehicle`)
      .set(auth)
      .send({ manufacturer: "Nissan" })
      .expect(422)
      .expect(({ body }) => expect(body.error.code).toBe("unsupported_vehicle"));

    await request(app)
      .patch(`/api/sessions/${created.id}/vehicle`)
      .set(auth)
      .send({ series: "100" })
      .expect(422)
      .expect(({ body }) => expect(body.error.code).toBe("invalid_request"));
  });

  it("rejects out-of-sequence answers and unknown workflow identifiers", async () => {
    const created = await createSession();
    const auth = { authorization: `Bearer ${created.token}` };

    await request(app)
      .post(`/api/sessions/${created.id}/answers`)
      .set(auth)
      .send({ questionId: "smoke-color", value: "white" })
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe("answer_not_current"));

    await request(app)
      .post(`/api/sessions/${created.id}/answers`)
      .set(auth)
      .send({ questionId: "complaint-category", value: "hard-start" })
      .expect(200);

    await request(app)
      .post(`/api/sessions/${created.id}/steps`)
      .set(auth)
      .send({ stepId: "made-up-step", completed: true })
      .expect(422);

    await request(app)
      .post(`/api/sessions/${created.id}/outcome`)
      .set(auth)
      .send({ resolved: "no", performedTestIds: ["made-up-test"] })
      .expect(422);
  });

  it("describes metadata-only media honestly and rejects implied model transport", async () => {
    const created = await createSession();
    const endpoint = `/api/sessions/${created.id}/evidence`;
    const auth = { authorization: `Bearer ${created.token}` };

    await request(app)
      .post(endpoint)
      .set(auth)
      .send({
        type: "photo",
        fileName: "engine.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 1024,
        allowModelAnalysis: true,
      })
      .expect(409)
      .expect(({ body }) =>
        expect(body.error.code).toBe("media_transport_not_configured"),
      );

    const saved = await request(app)
      .post(endpoint)
      .set(auth)
      .send({
        type: "photo",
        fileName: "engine.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 1024,
      })
      .expect(200);
    expect(saved.body.session.evidence[0].machineObservation).toBeUndefined();
    expect(saved.body.session.evidence[0].observationLimit).toMatch(/not uploaded/i);
  });

  it("protects session-scoped procedure state", async () => {
    const created = await createSession();
    const path = `/api/procedures/proc-injection-pump-timing?sessionId=${created.id}`;
    await request(app).get(path).expect(404);
    await request(app)
      .get(path)
      .set("authorization", `Bearer ${created.token}`)
      .expect(200)
      .expect(({ body }) => expect(body.contractVersion).toBe(API_CONTRACT_VERSION));
  });

  it("publishes only an inactive, reviewable forum-source registry", async () => {
    const response = await request(app).get("/api/ingestion/forum/sources").expect(200);
    expect(response.body.sources.length).toBeGreaterThan(0);
    expect(response.body.sources.every((source: { active: boolean }) => !source.active)).toBe(true);
  });
});
