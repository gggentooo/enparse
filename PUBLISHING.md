<!--
PUBLISHING.md — how to publish Enparse on Cloudflare (closed preview for colleagues)

Description:
  Step-by-step guide for the owner: package and check a release locally,
  upload the model files and dictionary to R2, deploy the app to Cloudflare
  Pages with its Functions, restrict access with Cloudflare Access, share it,
  and update it. Architecture: dev_meta/architecture.md → Deployment.

Status: written for release model-v1.0.0 (T66, 2026-11-23). 2026-11-24: the closed beta has
  ended and the site is open (step 5 is optional); the bucket is read-only for visitors (T99).
-->

# Publishing Enparse (closed preview)

Enparse is a static app plus about 750 MB of model and dictionary files. Everything runs in the visitor's browser; nothing is sent to a server.

| Part | Where it goes | Served at |
|---|---|---|
| App (`dist/`, from `npm run build`, 4.9 MB) | Cloudflare **Pages** project | `/` |
| Pages Functions (`functions/models`, `functions/dict`) | Same Pages project (bundled on deploy) | `/models/*`, `/dict/*` |
| Model files (`public/models/`), ONNX Runtime Web, dictionary | Cloudflare **R2** bucket, bound to the project as `MODELS` | through the Functions, on the same origin |
| Who may open it | Cloudflare **Access** (Zero Trust) | in front of the whole site |

The files go to R2 because Pages allows at most 25 MiB per file. The largest model file is 302 MB, and ONNX Runtime's `.wasm` is 26.9 MB.

`scripts/r2.ts` (`npm run r2`) knows which local file becomes which R2 key. The local preview (`npm run preview:release`) runs the same Functions against those files, so what you test locally is what you upload.

---

## 0. One-time prerequisites

1. **A Cloudflare account.** The free plan is enough.
2. **Node ≥ 23** (this repo uses Node 26) and **Google Chrome**, already used for the tests.
3. **Wrangler**, Cloudflare's CLI. It isn't a project dependency; `npx` fetches it when needed. Log in once:
   ```sh
   npx wrangler@4 login        # opens the browser; allow access
   npx wrangler@4 whoami       # shows your account
   ```
4. **The release files on this machine:**
   - Models are packaged in `public/models/` (step 1 below).
   - The dictionary is built in `training/data/dict/v1/` (`training/dictionary/build.py`, T70).

## 1. Package and check the release locally

```sh
# 1a. Package the offered models (from training/, venv active)
cd training && source .venv/bin/activate
python scripts/package_models.py      # → public/models/, reports/release.md
cd ..

# 1b. Unit and integration tests (packaged models vs Phase 9 outputs, catalog, Functions)
npm run typecheck && npm run lint && npm test

# 1c. End-to-end against the production build, served exactly as it will be deployed
npm run test:e2e:release

# 1d. Look at it yourself (Chrome and Safari): http://localhost:4173
npm run preview:release

# 1e. What will be uploaded (149 objects, ~744 MB)
npm run r2 -- list
```

In the preview, choose a model, parse a few sentences, open a word's dictionary entry, and switch models. Use a normal window: private windows don't have enough storage for the models.

## 2. Create the R2 bucket and upload

1. Create the bucket. Use the dashboard (**R2 Object Storage → Create bucket**, name `enparse-models`, location Automatic), or run:
   ```sh
   npx wrangler@4 r2 bucket create enparse-models
   ```
   Keep the bucket **private**: don't turn on the `r2.dev` public URL or a custom domain. The app reads it only through the Pages Functions.

   **Visitors must never be able to upload to the bucket** (owner rule, T99):
   - The Functions answer GET and HEAD only and never write; tests enforce this (`npm test`). Don't deploy Functions that fail them.
   - An R2 binding itself allows writes, so the Function code is the guard: don't add other Functions or Workers bound to this bucket.
   - Don't create R2 API tokens with write access for anything but your own uploads, and never put a token in the app or the repository.
   - Shared results (the "Share" button) need no storage: they travel in the link or as a file.
2. Upload:
   ```sh
   npm run r2 -- upload enparse-models --dry-run   # what would be uploaded
   npm run r2 -- upload enparse-models             # ~750 MB; a few minutes
   ```
   - Each file is uploaded with `wrangler r2 object put --remote`.
   - `catalog.json` goes last, so the app never lists a model whose files are missing.
   - Running it again skips files already uploaded from this machine with the same SHA-256. `--force` uploads everything again; `--only models|ort|dict` limits the upload to one part.
   - The largest file is 288 MiB. Wrangler has been reported to refuse files over 300 MiB. If a future model is bigger, upload that file with **rclone** using R2's S3 API (R2 → *Manage API tokens* → create an *Object Read & Write* token for the bucket; `rclone copyto public/models/<id>/onnx/model_fp16.onnx r2:enparse-models/<id>/onnx/model_fp16.onnx`).

R2 keys: model files at the bucket root (`catalog.json`, `modernbert_base/…`, `deberta_v3_xsmall/…`), ONNX Runtime under `_ort/`, the dictionary under `dict/v1/`.

## 3. Create the Pages project and deploy

Deploy from this machine with **Direct Upload** (recommended for the preview). It doesn't need the Git LFS model files on GitHub, and it deploys exactly what you tested.

```sh
npx wrangler@4 pages project create enparse --production-branch main
npm run build
npx wrangler@4 pages deploy dist --project-name enparse --branch main
```

- Run `deploy` from the **repository root**. Wrangler then bundles `functions/` with the site; the output should mention compiling the Functions/Worker.
- The site is at `https://enparse.pages.dev`. If the name is taken, Cloudflare adds a suffix; the command prints the URL.

**Bind the bucket** (once):

1. Dashboard → **Workers & Pages → enparse → Settings → Bindings → Add → R2 bucket**.
2. Variable name **`MODELS`**, bucket **`enparse-models`**.
3. Do this for **Production**, and for **Preview** if you'll use preview deployments.
4. Bindings apply to new deployments only, so **run the deploy command once more**.

> A Direct Upload project can't be switched to Git integration later. If you later want Cloudflare to build on every push, create a separate Git-connected project:
> - Build command: `npm run build`; output directory: `dist`.
> - Environment variable `NODE_VERSION=26`.
> - The same `MODELS` binding.
>
> The build doesn't need the model files: `public/models/` is left out of `dist/`.

## 4. Verify the deployment

Do this **before** turning on Access, or with a service token (step 5.5):

```sh
npm run r2 -- verify https://enparse.pages.dev
```

This checks every file through the Functions: the size of each model file (HEAD), and the SHA-256 of every JSON file. Then, in Chrome:

1. Open the site. In DevTools → Console, `crossOriginIsolated` must be `true`. If it's `false`, the `_headers` file isn't applied: you deployed something other than `dist/`.
2. **Models** → *Use this model* on **Large**. It should download (~306 MB with WebGPU, ~160 MB without), then show "Ready: Large".
3. Parse a paragraph. The output page says "Parsed with Large (1.0.0, WEBGPU)" (or WASM).
4. Open a word, then its dictionary entry, and add it to a list.

## 5. Restrict access to your colleagues (Cloudflare Access)

> Optional. The closed beta has ended and the site is open to everyone (2026-11-24); use this step only for a closed preview.

Cloudflare Zero Trust is free for up to 50 users. Colleagues sign in with a one-time code sent to their email; no accounts or passwords are needed.

1. Dashboard → **Zero Trust**. The first time, choose a team name and the **Free** plan; it may ask for a payment method even for Free.
2. **Login method:** *Settings → Authentication* → **One-time PIN** is on by default. Keep it, or add Google/GitHub if your colleagues have those.
3. **Protect the production site:**
   1. Go to **Access → Applications → Add an application → Self-hosted**.
   2. Application name: `Enparse preview`. Session duration: e.g. **1 month**, so people aren't asked often.
   3. Public hostname: `enparse.pages.dev` (no path, so the whole site is covered, including `/models` and `/dict`).
   4. Add a second hostname `*.enparse.pages.dev` to cover preview and per-deployment URLs.
   5. **Policy:** name `Colleagues`, action **Allow**, include **Emails** and list each colleague's address. Or use *Emails ending in* `@your-company.com`.
4. Save. Open the site in a private window: you should see the Cloudflare sign-in page. Enter an allowed address, then the emailed code, and the app opens.
   (Pages also has *Settings → General → Enable access policy*, but that protects only preview URLs, not `enparse.pages.dev`. Use the application above.)
5. **Optional, for `npm run r2 -- verify` behind Access:**
   1. Zero Trust → *Access → Service credentials → Service tokens → Create*.
   2. Add a second policy to the application: action **Service Auth**, include that token.
   3. Run:
      ```sh
      CF_ACCESS_CLIENT_ID=… CF_ACCESS_CLIENT_SECRET=… npm run r2 -- verify https://enparse.pages.dev
      ```

How the app behaves behind Access:

- All requests are same-origin, so model downloads carry the Access cookie. The web-app manifest is fetched with credentials too (`src/index.html`).
- After a model is downloaded, the app also works offline. When the session expires, the next online visit asks for the email code again; downloaded models stay.

## 6. Share it

Send your colleagues:

- **The link**, `https://enparse.pages.dev`, and the fact that they'll get a sign-in code by email.
- **Browser:** recent desktop Chrome or Edge works best, because WebGPU makes Large fast. Safari and Firefox work with WebAssembly. Use a normal (not private) window.
- **Storage:** the first model download is 160–310 MB and happens once. If Large is slow or doesn't load on their machine, they can choose **Compact** on the Models page.
- **What feedback you want**, with a way to send it (email, a form, a shared doc):
  - browser and device;
  - which model;
  - the exact sentence and what looked wrong.

  The app has no telemetry and sends nothing, so feedback reaches you only if they send it.

## 7. Update

| What changed | Steps |
|---|---|
| App code only | `npm test && npm run build && npx wrangler@4 pages deploy dist --project-name enparse --branch main`. Open tabs show the "new version — reload" banner. |
| Models (retrain or re-package) | 1. Bump `release.version` in `training/configs/catalog.yaml`. 2. Run step 1 (package, tests, `test:e2e:release`). 3. `npm run r2 -- upload enparse-models`. 4. `npm run r2 -- verify …`. The catalog and `labels.json` always revalidate, and model files are downloaded past the HTTP cache, so new downloads get the new files. Ask colleagues who downloaded the old version to delete the model on the Models page and download it again (not yet automatic; `todo.md` → T95). |
| Dictionary | Build a new version folder (`dict/v2/`) with `training/dictionary/build.py`, then `npm run r2 -- upload enparse-models --only dict`. |
| Who may open it | Zero Trust → Access → Applications → *Enparse preview* → edit the policy's email list. |
| Roll back the app | Workers & Pages → enparse → **Deployments** → pick an earlier one → *Rollback*. |

## 8. Costs and limits (free plans; check current Cloudflare pricing)

- **R2:** 10 GB-month of storage and free egress; this release uses ~0.75 GB. Each model download is a handful of read operations.
- **Pages Functions:** count against the Workers free plan's daily request limit (100,000 requests/day). A visitor's first model download is about 10 requests; dictionary lookups are a few requests each.
- **Access:** free for up to 50 users.

## 9. Git: commit, Git LFS, and the release tag

Commit and tag when you decide; nothing here does it for you. `public/models/**/*.onnx` is tracked with **Git LFS** (`.gitattributes`): about 690 MB for this release. Check your GitHub LFS storage and bandwidth quota before pushing. Then:

```sh
git lfs install                     # once per machine
git add public/models training/reports/release.md …   # with the code changes
git commit -m "(release) model-v1.0.0"
git tag -a model-v1.0.0 -m "Models 1.0.0 (training/reports/release.md)"
git push && git push origin model-v1.0.0
```

CI checks out without LFS. The packaged-model tests skip there (they detect pointer files), and the fake-backend end-to-end tests still run.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `/models/catalog.json` returns 404 | The `MODELS` binding is missing, or you didn't redeploy after adding it (step 3). Or the upload didn't finish: run `npm run r2 -- upload …` again. |
| The Models page says "not enough storage" | Private window, or the disk is almost full. Use a normal window. |
| `crossOriginIsolated` is `false`; WASM runs on one thread | The `_headers` file isn't deployed. Deploy `dist/` (it contains `_headers`). |
| A model fails with an integrity error after an update | The files in R2 don't match the catalog. Run `npm run r2 -- verify …`, then upload again (with `--force` if needed). |
| Sign-in loops, or there's no sign-in page | Check that the Access application's hostname matches the URL you opened (`enparse.pages.dev` vs. a `*.enparse.pages.dev` deployment URL). |
| The deploy fails: file over 25 MiB | `npm run build` refuses that already (`vite.config.ts`). Large files belong in R2. |
