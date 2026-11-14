import express, {
  type ErrorRequestHandler,
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import mongoose, { Types } from "mongoose";
import {
  clearAdminSessionCookie,
  createAdminSession,
  requireAdmin,
  setAdminSessionCookie,
  verifyAdminPassword,
} from "./auth.js";
import { createCloudinaryUploadSignature } from "./cloudinary.js";
import { Post, postCategories } from "./models/post.js";

const editableFields = new Set([
  "title",
  "slug",
  "subtitle",
  "excerpt",
  "category",
  "tags",
  "status",
  "publishedAt",
  "location",
  "readingTimeMinutes",
  "wordCount",
  "coverImage",
  "coverVideo",
  "content",
]);

type JsonRecord = Record<string, unknown>;

const asyncRoute = (
  handler: (request: Request, response: Response) => Promise<unknown>,
): RequestHandler => (request, response, next) => {
  void handler(request, response).catch(next);
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePostInput(value: unknown): JsonRecord {
  if (!isRecord(value)) {
    throw Object.assign(new Error("Request body must be a JSON object."), {
      status: 400,
    });
  }

  const unknownFields = Object.keys(value).filter((key) => !editableFields.has(key));
  if (unknownFields.length > 0) {
    throw Object.assign(
      new Error(`Unsupported post field: ${unknownFields.join(", ")}.`),
      { status: 400 },
    );
  }
  return value;
}

function parsePositiveInteger(
  value: unknown,
  fallback: number,
  maximum: number,
  name: string,
): number {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    throw Object.assign(new Error(`${name} must be a positive integer.`), {
      status: 400,
    });
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw Object.assign(new Error(`${name} is too large.`), { status: 400 });
  }
  return Math.min(parsed, maximum);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getRouteParam(value: string | string[], name: string): string {
  if (typeof value !== "string") {
    throw Object.assign(new Error(`${name} must be a single value.`), {
      status: 400,
    });
  }
  return value;
}

function isPostCategory(value: string): value is (typeof postCategories)[number] {
  return postCategories.some((category) => category === value);
}

function postIdentifierFilter(identifier: string): JsonRecord {
  if (Types.ObjectId.isValid(identifier)) {
    return {
      $or: [{ _id: identifier }, { slug: identifier.toLowerCase() }],
    };
  }
  return { slug: identifier.toLowerCase() };
}

export function createApp(): express.Express {
  const app = express();
  if (
    process.env.ADMIN_AUTH_DISABLED === "true" &&
    process.env.NODE_ENV !== "development"
  ) {
    throw new Error(
      "ADMIN_AUTH_DISABLED is allowed only when NODE_ENV=development.",
    );
  }
  const adminRouteAuth: RequestHandler =
    process.env.ADMIN_AUTH_DISABLED === "true"
      ? (_request, _response, next) => next()
      : requireAdmin;
  const allowedOrigins = new Set(
    (process.env.CLIENT_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );

  app.disable("x-powered-by");
  app.use((request, response, next) => {
    const origin = request.get("origin");
    if (origin && !allowedOrigins.has(origin)) {
      response.status(403).json({ error: "Origin is not allowed." });
      return;
    }

    if (origin) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Access-Control-Allow-Credentials", "true");
      response.setHeader("Vary", "Origin");
    }
    if (request.method === "OPTIONS") {
      response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      response.setHeader("Access-Control-Allow-Headers", "Content-Type");
      response.sendStatus(204);
      return;
    }
    next();
  });
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_request, response) => {
    const databaseConnected = mongoose.connection.readyState === 1;
    response.status(databaseConnected ? 200 : 503).json({
      status: databaseConnected ? "ok" : "unavailable",
      database: databaseConnected ? "connected" : "disconnected",
    });
  });

  app.post("/api/admin/session", asyncRoute(async (request, response) => {
    const body = request.body;
    if (
      !isRecord(body) ||
      typeof body.email !== "string" ||
      typeof body.password !== "string"
    ) {
      response.status(400).json({ error: "Email and password are required." });
      return;
    }

    const adminEmail = process.env.ADMIN_EMAIL;
    if (!adminEmail || !process.env.ADMIN_PASSWORD_HASH) {
      throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD_HASH must be configured.");
    }
    if (
      body.email.trim().toLowerCase() !== adminEmail.trim().toLowerCase() ||
      !verifyAdminPassword(body.password)
    ) {
      response.status(401).json({ error: "Invalid email or password." });
      return;
    }

    setAdminSessionCookie(response, createAdminSession(adminEmail));
    response.json({ email: adminEmail });
  }));

  app.delete("/api/admin/session", (_request, response) => {
    if (process.env.ADMIN_AUTH_DISABLED === "true") {
      response.json({ authDisabled: true });
      return;
    }
    clearAdminSessionCookie(response);
    response.sendStatus(204);
  });

  app.post(
    "/api/admin/media/signature",
    adminRouteAuth,
    (request, response, next) => {
      try {
        const body = request.body;
        if (
          !isRecord(body) ||
          typeof body.slug !== "string" ||
          !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(body.slug) ||
          body.slug.length > 200 ||
          (body.resourceType !== "image" && body.resourceType !== "video")
        ) {
          response.status(400).json({
            error: "A valid post slug and image or video resource type are required.",
          });
          return;
        }

        response.json(
          createCloudinaryUploadSignature(`journal/${body.slug}`),
        );
      } catch (error) {
        next(error);
      }
    },
  );

  app.get("/api/posts", asyncRoute(async (request, response) => {
    const category = request.query.category;
    if (category !== undefined && typeof category !== "string") {
      response.status(400).json({ error: "category must be a single value." });
      return;
    }
    if (typeof category === "string" && !isPostCategory(category)) {
      response.status(400).json({ error: "Unknown post category." });
      return;
    }

    const search = request.query.search;
    if (search !== undefined && typeof search !== "string") {
      response.status(400).json({ error: "search must be a single value." });
      return;
    }

    const page = parsePositiveInteger(request.query.page, 1, 1_000_000, "page");
    const limit = parsePositiveInteger(request.query.limit, 20, 100, "limit");
    const filter: JsonRecord = { status: "published" };
    if (category) filter.category = category;
    if (search?.trim()) {
      const expression = new RegExp(escapeRegex(search.trim()), "i");
      filter.$or = [
        { title: expression },
        { excerpt: expression },
        { tags: expression },
      ];
    }

    const [posts, total] = await Promise.all([
      Post.find(filter)
        .sort({ publishedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Post.countDocuments(filter),
    ]);
    response.json({ posts, total, page, pages: Math.ceil(total / limit) });
  }));

  app.get("/api/posts/category/:category", asyncRoute(async (request, response) => {
    const category = getRouteParam(request.params.category, "category");
    if (!isPostCategory(category)) {
      response.status(400).json({ error: "Unknown post category." });
      return;
    }

    const posts = await Post.find({ category, status: "published" })
      .sort({ publishedAt: -1 })
      .lean();
    response.json(posts);
  }));

  app.get("/api/posts/title/:title", asyncRoute(async (request, response) => {
    const title = getRouteParam(request.params.title, "title");
    const post = await Post.findOne({
      title: new RegExp(`^${escapeRegex(title)}$`, "i"),
      status: "published",
    }).lean();
    if (!post) {
      response.status(404).json({ error: "Post not found." });
      return;
    }
    response.json(post);
  }));

  app.get("/api/posts/:identifier", asyncRoute(async (request, response) => {
    const filter = postIdentifierFilter(
      getRouteParam(request.params.identifier, "identifier"),
    );
    const post = await Post.findOne({ ...filter, status: "published" }).lean();
    if (!post) {
      response.status(404).json({ error: "Post not found." });
      return;
    }
    response.json(post);
  }));

  app.get("/api/admin/posts", adminRouteAuth, asyncRoute(async (_request, response) => {
    const posts = await Post.find().sort({ updatedAt: -1 }).lean();
    response.json(posts);
  }));

  app.post("/api/admin/posts", adminRouteAuth, asyncRoute(async (request, response) => {
    const input = parsePostInput(request.body);
    if (input.status === "published" && input.publishedAt === undefined) {
      input.publishedAt = new Date();
    }
    if (input.status !== "published") input.publishedAt = null;
    const post = await Post.create(input);
    response.status(201).json(post);
  }));

  app.get("/api/admin/posts/:id/preview", adminRouteAuth, asyncRoute(async (request, response) => {
    const id = getRouteParam(request.params.id, "id");
    if (!Types.ObjectId.isValid(id)) {
      response.status(400).json({ error: "Post id is invalid." });
      return;
    }
    const post = await Post.findById(id).lean();
    if (!post) {
      response.status(404).json({ error: "Post not found." });
      return;
    }
    response.json(post);
  }));

  app.get("/api/admin/posts/:id", adminRouteAuth, asyncRoute(async (request, response) => {
    const id = getRouteParam(request.params.id, "id");
    if (!Types.ObjectId.isValid(id)) {
      response.status(400).json({ error: "Post id is invalid." });
      return;
    }
    const post = await Post.findById(id).lean();
    if (!post) {
      response.status(404).json({ error: "Post not found." });
      return;
    }
    response.json(post);
  }));

  app.put("/api/admin/posts/:id", adminRouteAuth, asyncRoute(async (request, response) => {
    const id = getRouteParam(request.params.id, "id");
    if (!Types.ObjectId.isValid(id)) {
      response.status(400).json({ error: "Post id is invalid." });
      return;
    }
    const input = parsePostInput(request.body);
    const post = await Post.findById(id);
    if (!post) {
      response.status(404).json({ error: "Post not found." });
      return;
    }

    if (input.status === "published" && post.status !== "published" && input.publishedAt === undefined) {
      input.publishedAt = new Date();
    }
    if (input.status === "draft") input.publishedAt = null;
    for (const [field, value] of Object.entries(input)) {
      post.set(field, value);
    }
    await post.save();
    response.json(post);
  }));

  app.delete("/api/admin/posts/:id", adminRouteAuth, asyncRoute(async (request, response) => {
    const id = getRouteParam(request.params.id, "id");
    if (!Types.ObjectId.isValid(id)) {
      response.status(400).json({ error: "Post id is invalid." });
      return;
    }
    const post = await Post.findByIdAndDelete(id);
    if (!post) {
      response.status(404).json({ error: "Post not found." });
      return;
    }
    response.sendStatus(204);
  }));

  app.use((_request, response) => {
    response.status(404).json({ error: "API route not found." });
  });

  const handleError: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
    const status =
      typeof error === "object" && error !== null && "status" in error &&
      typeof error.status === "number"
        ? error.status
        : error instanceof mongoose.Error.ValidationError ||
            error instanceof mongoose.Error.CastError
          ? 400
          : typeof error === "object" && error !== null && "code" in error &&
              error.code === 11000
            ? 409
            : error instanceof SyntaxError
              ? 400
              : 500;
    const message = status === 500
      ? "An unexpected server error occurred."
      : error instanceof Error
        ? error.message
        : "Request failed.";
    if (status === 500) console.error(error);
    response.status(status).json({ error: message });
  };
  app.use(handleError);

  return app;
}
