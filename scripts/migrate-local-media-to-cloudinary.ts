import "dotenv/config";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { configureCloudinary } from "../src/cloudinary.js";
import { Post } from "../src/models/post.js";

const publicImagesDirectory = fileURLToPath(
  new URL("../../frontend-journal/public/post-images/", import.meta.url),
);
const localImageReference = /\/post-images\/([^)\s"'<>]+)/g;
const isDryRun = process.argv.includes("--dry-run");
const skipOversizedAssets = process.argv.includes("--skip-oversized");
const maxCloudinaryUploadBytes = 10 * 1024 * 1024;

function localAssetName(url: string | undefined): string | null {
  if (!url) return null;
  const match = /\/post-images\/([^?#]+)/.exec(url);
  if (!match) return null;

  let name: string;
  try {
    name = decodeURIComponent(match[1]);
  } catch {
    throw new Error(`Invalid encoded local media URL: ${url}`);
  }
  if (!name || name !== path.posix.basename(name)) {
    throw new Error(`Invalid local media filename in URL: ${url}`);
  }
  return name;
}

async function main() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) throw new Error("MONGODB_URI must be configured.");
  await mongoose.connect(mongoUri);

  const posts = await Post.find().select("content coverImage coverVideo").exec();
  const referencedAssets = new Set<string>();
  for (const post of posts) {
    for (const url of [post.coverImage?.url, post.coverVideo?.url]) {
      const name = localAssetName(url);
      if (name) referencedAssets.add(name);
    }
    for (const match of post.content.matchAll(localImageReference)) {
      const name = localAssetName(`/post-images/${match[1]}`);
      if (name) referencedAssets.add(name);
    }
  }

  const availableAssets = new Set(await readdir(publicImagesDirectory));
  const missingAssets = [...referencedAssets].filter((name) => !availableAssets.has(name));
  if (missingAssets.length > 0) {
    throw new Error(
      `Local referenced media is missing from frontend-journal/public/post-images: ${missingAssets.join(", ")}`,
    );
  }

  const oversizedAssets: string[] = [];
  for (const name of referencedAssets) {
    const file = await stat(path.join(publicImagesDirectory, name));
    if (file.size > maxCloudinaryUploadBytes) oversizedAssets.push(name);
  }

  console.log(`Found ${referencedAssets.size} local media assets referenced by ${posts.length} posts.`);
  if (oversizedAssets.length > 0) {
    for (const name of oversizedAssets) {
      console.log(
        `${skipOversizedAssets ? "Skipping" : "Too large for Cloudinary"} ${name} (maximum 10 MiB).`,
      );
    }
    if (!skipOversizedAssets && !isDryRun) {
      throw new Error(
        `Found ${oversizedAssets.length} oversized asset(s). Rerun with --skip-oversized to migrate the others.`,
      );
    }
  }

  const oversizedAssetSet = new Set(oversizedAssets);
  const assetsToUpload = skipOversizedAssets
    ? [...referencedAssets].filter((name) => !oversizedAssetSet.has(name))
    : [...referencedAssets];
  if (isDryRun) {
    if (skipOversizedAssets) {
      console.log(
        `Dry run complete; ${assetsToUpload.length} asset(s) would be uploaded and ${oversizedAssets.length} skipped.`,
      );
    } else if (oversizedAssets.length > 0) {
      console.log(
        `Dry run complete; ${referencedAssets.size - oversizedAssets.length} asset(s) are within the 10 MiB limit. Rerun with --skip-oversized to migrate those and leave the larger files unchanged.`,
      );
    }
    console.log("Cloudinary and MongoDB were not changed.");
    return;
  }

  const cloudinary = configureCloudinary();
  const mediaByName = new Map<string, { url: string; publicId: string }>();
  for (const name of assetsToUpload) {
    const extension = path.extname(name);
    const publicId = path.basename(name, extension);
    const resource = await cloudinary.uploader.upload(
      path.join(publicImagesDirectory, name),
      {
        folder: "journal/imported",
        public_id: publicId,
        resource_type: "auto",
        overwrite: true,
        unique_filename: false,
      },
    );
    if (!resource.secure_url || !resource.public_id) {
      throw new Error(`Cloudinary did not return a URL for "${name}".`);
    }
    mediaByName.set(name, {
      url: resource.secure_url,
      publicId: resource.public_id,
    });
    console.log(`Uploaded ${name}`);
  }

  let updatedPosts = 0;
  for (const post of posts) {
    let changed = false;
    const content = post.content.replace(localImageReference, (reference) => {
      const name = localAssetName(reference);
      const media = name ? mediaByName.get(name) : undefined;
      if (!media) return reference;
      changed = true;
      return media.url;
    });

    for (const field of ["coverImage", "coverVideo"] as const) {
      const mediaReference = post[field];
      const name = localAssetName(mediaReference?.url);
      const media = name ? mediaByName.get(name) : undefined;
      if (!mediaReference || !media) continue;
      mediaReference.url = media.url;
      mediaReference.publicId = media.publicId;
      changed = true;
    }

    if (!changed) continue;
    post.content = content;
    await post.save();
    updatedPosts += 1;
  }
  console.log(
    `Cloudinary migration complete: ${assetsToUpload.length} assets uploaded, ${oversizedAssets.length} oversized assets skipped, and ${updatedPosts} posts updated.`,
  );
}

try {
  await main();
} catch (error) {
  console.error("Local media migration failed:", error);
  process.exitCode = 1;
} finally {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}
