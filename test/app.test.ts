import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createApp } from "../src/app.js";

test("API reports database readiness and validates public category routes", async () => {
  const app = createApp();
  const server = app.listen(0);
  await once(server, "listening");

  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const health = await fetch(`${baseUrl}/api/health`);
    assert.equal(health.status, 503);
    assert.deepEqual(await health.json(), {
      status: "unavailable",
      database: "disconnected",
    });

    const category = await fetch(`${baseUrl}/api/posts/category/invalid`);
    assert.equal(category.status, 400);
    assert.deepEqual(await category.json(), { error: "Unknown post category." });

    const preview = await fetch(`${baseUrl}/api/admin/posts/123/preview`);
    assert.equal(preview.status, 401);
    assert.deepEqual(await preview.json(), {
      error: "Admin authentication required.",
    });
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("admin routes bypass sessions only in explicit development mode", async () => {
  const previousDisabled = process.env.ADMIN_AUTH_DISABLED;
  const previousNodeEnv = process.env.NODE_ENV;

  try {
    process.env.ADMIN_AUTH_DISABLED = "true";
    process.env.NODE_ENV = "production";
    assert.throws(
      () => createApp(),
      /ADMIN_AUTH_DISABLED is allowed only when NODE_ENV=development/,
    );

    delete process.env.NODE_ENV;
    assert.throws(
      () => createApp(),
      /ADMIN_AUTH_DISABLED is allowed only when NODE_ENV=development/,
    );

    process.env.NODE_ENV = "development";
    const app = createApp();
    const server = app.listen(0);
    await once(server, "listening");
    try {
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const preview = await fetch(
        `http://127.0.0.1:${address.port}/api/admin/posts/not-an-id/preview`,
      );
      assert.equal(preview.status, 400);
      assert.deepEqual(await preview.json(), { error: "Post id is invalid." });
    } finally {
      server.close();
      await once(server, "close");
    }
  } finally {
    if (previousDisabled === undefined) delete process.env.ADMIN_AUTH_DISABLED;
    else process.env.ADMIN_AUTH_DISABLED = previousDisabled;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});

test("admin media endpoint returns a short-lived Cloudinary upload signature", async () => {
  const originalEnvironment = {
    adminAuthDisabled: process.env.ADMIN_AUTH_DISABLED,
    nodeEnv: process.env.NODE_ENV,
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
  };
  process.env.ADMIN_AUTH_DISABLED = "true";
  process.env.NODE_ENV = "development";
  process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
  process.env.CLOUDINARY_API_KEY = "test-api-key";
  process.env.CLOUDINARY_API_SECRET = "test-api-secret";

  const server = createApp().listen(0);
  await once(server, "listening");
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/admin/media/signature`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: "my-post", resourceType: "image" }),
      },
    );
    assert.equal(response.status, 200);
    const signature = await response.json() as Record<string, unknown>;
    assert.equal(signature.cloudName, "test-cloud");
    assert.equal(signature.folder, "journal/my-post");
    assert.equal(signature.apiKey, "test-api-key");
    assert.equal(typeof signature.timestamp, "number");
    assert.equal(typeof signature.signature, "string");
    assert.equal("apiSecret" in signature, false);

    const invalidRequest = await fetch(
      `http://127.0.0.1:${address.port}/api/admin/media/signature`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: "../private", resourceType: "image" }),
      },
    );
    assert.equal(invalidRequest.status, 400);
  } finally {
    server.close();
    await once(server, "close");
    if (originalEnvironment.adminAuthDisabled === undefined) delete process.env.ADMIN_AUTH_DISABLED;
    else process.env.ADMIN_AUTH_DISABLED = originalEnvironment.adminAuthDisabled;
    if (originalEnvironment.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnvironment.nodeEnv;
    if (originalEnvironment.cloudName === undefined) delete process.env.CLOUDINARY_CLOUD_NAME;
    else process.env.CLOUDINARY_CLOUD_NAME = originalEnvironment.cloudName;
    if (originalEnvironment.apiKey === undefined) delete process.env.CLOUDINARY_API_KEY;
    else process.env.CLOUDINARY_API_KEY = originalEnvironment.apiKey;
    if (originalEnvironment.apiSecret === undefined) delete process.env.CLOUDINARY_API_SECRET;
    else process.env.CLOUDINARY_API_SECRET = originalEnvironment.apiSecret;
  }
});
