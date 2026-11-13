import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { getPostPath, posts as legacyPosts } from "../../frontend-journal/src/data/posts.ts";
import { Post } from "../src/models/post.js";

type LegacyArticle = {
  title?: string;
  subtitle?: string;
  excerpt?: string;
  category?: string;
  tags?: unknown;
  publishedAt?: string;
  updatedAt?: string;
  location?: string;
  readingTimeMinutes?: string | number;
  wordCount?: string | number | null;
  coverImage?: string;
  coverVideo?: string;
  content?: string;
};

const articleDirectory = fileURLToPath(
  new URL("../../frontend-journal/src/data/posts/", import.meta.url),
);
const isDryRun = process.argv.includes("--dry-run");

function optionalNumber(value: string | number | null | undefined): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function makeRecord(
  legacyPost: (typeof legacyPosts)[number],
  article: LegacyArticle,
) {
  const slug = getPostPath(legacyPost).split("/").at(-1);
  if (!slug) throw new Error(`Could not create a slug for "${legacyPost.title}".`);
  if (!article.content?.trim()) {
    throw new Error(`"${slug}" has no article content and cannot be published.`);
  }
  if (!article.publishedAt || Number.isNaN(Date.parse(article.publishedAt))) {
    throw new Error(`"${slug}" has no valid publication date.`);
  }

  const image = article.coverImage || legacyPost.image;
  const video =
    article.coverVideo ||
    (/\.(mp4|webm|mov)(?:$|[?#])/i.test(image) ? image : "");
  const record = {
    title: legacyPost.title,
    slug,
    subtitle: article.subtitle || "",
    excerpt: legacyPost.excerpt || article.excerpt || "",
    category: legacyPost.category,
    tags: Array.isArray(article.tags)
      ? article.tags.filter((tag): tag is string => typeof tag === "string")
      : [],
    status: "published",
    publishedAt: new Date(article.publishedAt),
    location: article.location || "",
    readingTimeMinutes: optionalNumber(article.readingTimeMinutes) || null,
    wordCount: optionalNumber(article.wordCount),
    coverImage: image ? { url: image } : null,
    coverVideo: video ? { url: video } : null,
    content: article.content,
    views: optionalNumber(legacyPost.views) ?? 0,
  } as const;
  const validationError = new Post(record).validateSync();
  if (validationError) {
    throw new Error(`"${slug}" failed post validation: ${validationError.message}`);
  }
  return record;
}

async function main() {
  const records = [];
  for (const legacyPost of legacyPosts) {
    const slug = getPostPath(legacyPost).split("/").at(-1);
    if (!slug) throw new Error(`Could not create a slug for "${legacyPost.title}".`);

    let article: LegacyArticle;
    try {
      article = JSON.parse(
        await readFile(path.join(articleDirectory, `${slug}.json`), "utf8"),
      ) as LegacyArticle;
    } catch (error) {
      throw new Error(`Could not load legacy article "${slug}.json".`, {
        cause: error,
      });
    }
    records.push(makeRecord(legacyPost, article));
  }

  console.log(`Validated ${records.length} legacy journal posts.`);
  if (isDryRun) {
    console.log("Dry run complete; MongoDB was not changed.");
    return;
  }

  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) throw new Error("MONGODB_URI must be configured.");

  await mongoose.connect(mongoUri);
  let inserted = 0;
  let skipped = 0;
  for (const record of records) {
    const result = await Post.updateOne(
      { slug: record.slug },
      { $setOnInsert: record },
      { upsert: true, runValidators: true },
    );
    if (result.upsertedCount > 0) inserted += 1;
    else skipped += 1;
  }
  console.log(`Migration complete: ${inserted} inserted, ${skipped} already existed.`);
}

try {
  await main();
} catch (error) {
  console.error("Legacy post migration failed:", error);
  process.exitCode = 1;
} finally {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}
