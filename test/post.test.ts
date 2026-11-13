import assert from "node:assert/strict";
import test from "node:test";
import { Post } from "../src/models/post.js";

test("accepts a draft with the minimum editor fields", () => {
  const post = new Post({
    title: "A new story",
    slug: "a-new-story",
    category: "Travel",
  });

  assert.equal(post.validateSync(), undefined);
  assert.equal(post.status, "draft");
  assert.deepEqual(post.tags, []);
});

test("requires article content and a publication date for published posts", () => {
  const post = new Post({
    title: "A published story",
    slug: "a-published-story",
    category: "Travel",
    status: "published",
  });
  const error = post.validateSync();

  assert.ok(error);
  assert.ok(error.errors.content);
  assert.ok(error.errors.excerpt);
  assert.ok(error.errors.publishedAt);
});

test("rejects malformed slugs and invalid media references", () => {
  const post = new Post({
    title: "A story",
    slug: "A story!",
    category: "Travel",
    coverImage: { url: "" },
  });
  const error = post.validateSync();

  assert.ok(error);
  assert.ok(error.errors.slug);
  assert.ok(error.errors["coverImage.url"]);
});

test("rejects categories outside the four supported categories", () => {
  const post = new Post({
    title: "A story",
    slug: "a-story",
    category: "Trips-Treks-Travels",
  });

  assert.ok(post.validateSync()?.errors.category);
});

test("accepts published articles with the public journal's content fields", () => {
  const post = new Post({
    title: "A Drive To The Mountains",
    slug: "a-drive-to-the-mountains",
    subtitle: "A weekend road trip",
    excerpt: "A story about a trip into the hills.",
    category: "Travel",
    tags: ["Ooty", "Road Trip"],
    status: "published",
    publishedAt: new Date("2026-05-06T00:00:00.000Z"),
    location: "Kotagiri, Nilgiris",
    readingTimeMinutes: 7,
    wordCount: 1200,
    coverVideo: {
      url: "https://res.cloudinary.com/example/video/upload/drive.mp4",
      publicId: "journal/drive",
    },
    content: "## The trip\n\nA Markdown journal entry.",
  });

  assert.equal(post.validateSync(), undefined);
});
