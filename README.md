# Journal backend

The backend is an independent TypeScript API for the public journal and admin
app. Deploy it at its own API URL, separate from the frontend and admin URLs.
It connects to MongoDB Atlas and keeps database and admin credentials server-side.

## Post record

The initial MongoDB schema is in `src/models/post.ts`. It retains the current
journal's article fields while adding a stable slug and draft/published status.
Media references store a URL and optional Cloudinary `publicId`; content remains
Markdown. `createdAt` and `updatedAt` are managed by Mongoose.

Categories are restricted to `Travel`, `Life`, `Stories`, and `Poetry`.
Published posts require an excerpt, Markdown content, and `publishedAt`; drafts
may be incomplete. During migration, existing article category labels must map
to one of these four archive categories.

## API

- `GET /api/health` — API readiness
- `GET /api/posts` — published posts; optional `category`, `search`, `page`,
  and `limit` query parameters
- `GET /api/posts/category/:category` — published posts in one category
- `GET /api/posts/title/:title` — published post by exact title
- `GET /api/posts/:identifier` — published post by slug or MongoDB id
- `POST /api/admin/session` and `DELETE /api/admin/session` — admin login/logout
- `GET|POST /api/admin/posts` — list all posts and create a draft/published post
- `GET|PUT|DELETE /api/admin/posts/:id` — read, edit, or delete a post
- `GET /api/admin/posts/:id/preview` — preview a post, including drafts

Admin post routes and previews require the HttpOnly admin session cookie.
Published public endpoints never include drafts. Posts can be edited with `PUT`
using the fields being changed; model validation runs before saving. New posts
default to `draft`; publishing sets `publishedAt` if it was not supplied.

## Configuration and deployment

Copy `.env.example` to `.env`. Configure `MONGODB_URI` with the MongoDB Atlas
connection string stored in your deployment's secret manager; do not commit it.
`CLIENT_ORIGINS` is a comma-separated allowlist of the deployed frontend and
admin origins. Set the API URL separately in each client; the API does not host
either app. Admin browser requests must include credentials so the session cookie
is sent. Production admin sessions use secure, cross-site cookies, so deploy the
frontend, admin, and API over HTTPS.

To create a password hash, run `npm run hash-password` and set its output as
`ADMIN_PASSWORD_HASH`. Set `ADMIN_EMAIL` and a random `SESSION_SECRET` of at
least 32 characters. The password hash format is `scrypt$salt$hex`.

For local UI development only, run the backend with `NODE_ENV=development` and
set `ADMIN_AUTH_DISABLED=true` to let the admin app call the post-management
routes without signing in. The API refuses this setting in every other
environment. Leave it `false` for deployed environments.

## Local checks

```sh
npm install
npm run dev
npm test
npm run build
```

The API listens on port `4000` by default. Never commit `.env` or production
credentials.

## Cloudinary media

Set `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and
`CLOUDINARY_API_SECRET` on the backend. The admin editor requests a signed
upload; the API secret stays on the server. Cover images, cover videos, and
inline editor images upload directly to Cloudinary and save their secure URL and
public ID on the post.

To move local `/post-images/...` URLs already stored in MongoDB, run a dry run
first, then perform the upload and URL replacement:

```sh
npm run migrate:cloudinary -- --dry-run
npm run migrate:cloudinary
```

The migration uploads only assets referenced by posts from
`../frontend-journal/public/post-images`, then updates post cover fields and
Markdown references. Existing externally hosted media is left unchanged. To
migrate all files under Cloudinary's 10 MiB upload limit and leave larger local
media references unchanged, pass `--skip-oversized`:

```sh
npm run migrate:cloudinary -- --dry-run --skip-oversized
npm run migrate:cloudinary -- --skip-oversized
```

## Import the existing journal

The public site's original archive cards and article JSON are retained in
`../frontend-journal/src/data` as a migration source and backup. From this
directory, first validate all 35 entries without writing to MongoDB:

```sh
npm run migrate:legacy -- --dry-run
```

After confirming `MONGODB_URI` points to the intended database, run:

```sh
npm run migrate:legacy
```

The import is safe to rerun: it inserts missing published posts and leaves
existing records (including admin edits) untouched.

## Public frontend

Set `VITE_API_URL` in `../frontend-journal/.env` to the backend URL (the local
default is `http://localhost:4000`), and include the frontend's origin in
`CLIENT_ORIGINS`. The frontend fetches only published posts and article content
from the API. Configure the same API URL at build time for production.
