import { test, expect } from "@playwright/test";
import { createCompanionClient } from "../src/companionClient.js";

test("a localhost request that never answers becomes a retryable timeout", async () => {
  let aborted = false;
  const fetchImpl = (_url, options) =>
    new Promise((_resolve, reject) => {
      options.signal.addEventListener(
        "abort",
        () => {
          aborted = true;
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        },
        { once: true }
      );
    });

  const client = createCompanionClient({ fetchImpl, timeoutMs: 25 });
  await expect(client.health()).rejects.toMatchObject({
    name: "CompanionHttpError",
    code: "companion_timeout",
  });
  expect(aborted).toBe(true);
});

test("headers without a completed JSON body are covered by the same timeout", async () => {
  let bodyAborted = false;
  const fetchImpl = async (_url, options) => ({
    ok: true,
    status: 200,
    json: () =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener(
          "abort",
          () => {
            bodyAborted = true;
            const err = new Error("body aborted");
            err.name = "AbortError";
            reject(err);
          },
          { once: true }
        );
      }),
  });

  const client = createCompanionClient({ fetchImpl, timeoutMs: 25 });
  await expect(client.health()).rejects.toMatchObject({
    name: "CompanionHttpError",
    code: "companion_timeout",
  });
  expect(bodyAborted).toBe(true);
});
