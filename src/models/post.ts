import { InferSchemaType, Schema, model } from "mongoose";

export const postCategories = ["Travel", "Life", "Stories", "Poetry"] as const;

const mediaReferenceSchema = new Schema(
  {
    url: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2048,
    },
    publicId: {
      type: String,
      trim: true,
      maxlength: 255,
    },
  },
  { _id: false },
);

export const postSchema = new Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 200,
      match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      unique: true,
    },
    subtitle: {
      type: String,
      trim: true,
      maxlength: 300,
      default: "",
    },
    excerpt: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: "",
      required(this: { status?: string }) {
        return this.status === "published";
      },
    },
    category: {
      type: String,
      required: true,
      trim: true,
      enum: postCategories,
    },
    tags: {
      type: [String],
      default: [],
      validate: {
        validator: (tags: string[]) =>
          tags.length <= 20 &&
          tags.every((tag) => tag.trim().length > 0 && tag.trim().length <= 40),
        message: "Posts may have at most 20 tags, each between 1 and 40 characters.",
      },
    },
    status: {
      type: String,
      enum: ["draft", "published"],
      default: "draft",
      index: true,
    },
    publishedAt: {
      type: Date,
      default: null,
      required(this: { status?: string }) {
        return this.status === "published";
      },
    },
    location: {
      type: String,
      trim: true,
      maxlength: 120,
      default: "",
    },
    readingTimeMinutes: {
      type: Number,
      min: 1,
      default: null,
    },
    wordCount: {
      type: Number,
      min: 0,
      default: null,
    },
    coverImage: {
      type: mediaReferenceSchema,
      default: null,
    },
    coverVideo: {
      type: mediaReferenceSchema,
      default: null,
    },
    content: {
      type: String,
      default: "",
      required(this: { status?: string }) {
        return this.status === "published";
      },
    },
    views: {
      type: Number,
      min: 0,
      default: 0,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

postSchema.index({ status: 1, publishedAt: -1 });

export type PostRecord = InferSchemaType<typeof postSchema>;

export const Post = model("Post", postSchema);
