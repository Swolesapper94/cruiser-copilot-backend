import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createSessionAccess,
  FileSessionStore,
  newSession,
} from "./index";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("FileSessionStore", () => {
  it("survives a restart without persisting the bearer token", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "cruiser-session-store-"));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, "sessions.json");
    const first = new FileSessionStore(filePath);
    await first.load();

    const access = createSessionAccess();
    const session = newSession("ses-persistence-test", "Hard cold start");
    await first.create(session, access.tokenHash);

    const serialized = await readFile(filePath, "utf8");
    expect(serialized).not.toContain(access.accessToken);

    const restarted = new FileSessionStore(filePath);
    await restarted.load();
    expect(await restarted.authorize(session.id, access.accessToken)).toMatchObject({
      id: session.id,
      complaint: session.complaint,
    });
    expect(await restarted.authorize(session.id, "wrong-token")).toBeUndefined();
  });
});
