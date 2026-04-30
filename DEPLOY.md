# DocScanPro — Step-by-Step Deployment Guide

This guide deploys:
- **Frontend** → Cloudflare Pages (free, unlimited bandwidth)
- **Backend** → Railway (free starter tier, Python/Docker)

Total time: ~20 minutes. No credit card needed.

---

## PART 1 — GitHub (5 min)

GitHub is the bridge between your code and both hosting platforms.

### Step 1.1 — Create a GitHub account
Go to https://github.com/signup if you don't have one.

### Step 1.2 — Create a new repository
1. Click the **+** in the top-right → "New repository"
2. Name it: `docscanner`
3. Keep it **Public** (required for free Cloudflare Pages CI)
4. Do NOT tick "Add a README" (we already have one)
5. Click **Create repository**

### Step 1.3 — Push your code
Open your terminal in the `docscanner/` folder and run:

```bash
git remote add origin https://github.com/YOUR_USERNAME/docscanner.git
git branch -M main
git push -u origin main
```

Replace `YOUR_USERNAME` with your actual GitHub username.

✅ Check: Visit `https://github.com/YOUR_USERNAME/docscanner` — you should see all the files.

---

## PART 2 — Backend on Railway (8 min)

Railway runs your Python API (pytesseract, OCRmyPDF, etc.) in a Docker container.

### Step 2.1 — Create Railway account
Go to https://railway.app → "Login with GitHub" — this links your repos automatically.

### Step 2.2 — Create a new project
1. Click **New Project**
2. Click **Deploy from GitHub repo**
3. Select your `docscanner` repository
4. Railway will detect the Dockerfile automatically

### Step 2.3 — Set the root directory
Railway needs to know the backend is in a subfolder:
1. Click on your service (the box that appeared)
2. Go to **Settings** tab
3. Under **Source** → set **Root Directory** to: `backend`
4. Click **Save**

### Step 2.4 — Set the port
1. Still in Settings → scroll to **Networking**
2. Click **Generate Domain** — Railway gives you a free URL
3. Under **Deploy** → set **Start Command** to:
   ```
   uvicorn main:app --host 0.0.0.0 --port $PORT
   ```
4. Click **Save** → Railway will redeploy automatically

### Step 2.5 — Wait for the build
The first build takes 3–5 minutes (installs Tesseract, Poppler, Ghostscript).
Watch the **Deploy Logs** tab — look for:
```
INFO:     Application startup complete.
```

### Step 2.6 — Note your backend URL
Copy the URL Railway gave you. It looks like:
```
https://docscanner-production-xxxx.up.railway.app
```
You'll need this in Part 3.

### Step 2.7 — Test it
Open in your browser:
```
https://docscanner-production-xxxx.up.railway.app/api/health
```
You should see JSON like:
```json
{
  "status": "ok",
  "capabilities": {
    "ocr_pytesseract": true,
    "pdf2image": true,
    "ocrmypdf": true,
    "docx_export": true,
    "pdf_export": true
  }
}
```
✅ All `true` means the backend is fully operational.

---

## PART 3 — Frontend on Cloudflare Pages (5 min)

### Step 3.1 — Create Cloudflare account
Go to https://dash.cloudflare.com/sign-up (free, no credit card).

### Step 3.2 — Connect GitHub
1. In the Cloudflare dashboard, click **Workers & Pages** in the left sidebar
2. Click **Create application**
3. Click the **Pages** tab
4. Click **Connect to Git**
5. Authorize Cloudflare to access your GitHub
6. Select your `docscanner` repository
7. Click **Begin setup**

### Step 3.3 — Configure the build
Fill in these fields exactly:

| Field | Value |
|-------|-------|
| **Project name** | `docscanner` |
| **Production branch** | `main` |
| **Framework preset** | `Vite` |
| **Build command** | `cd frontend && npm install && npm run build` |
| **Build output directory** | `frontend/dist` |

### Step 3.4 — Add the backend URL as an environment variable
Still on the setup page, scroll to **Environment variables**:
1. Click **Add variable**
2. Name: `VITE_API_URL`
3. Value: `https://docscanner-production-xxxx.up.railway.app`
   (paste your Railway URL from Step 2.6 — no trailing slash)
4. Click **Save**

### Step 3.5 — Deploy
Click **Save and Deploy**.

Cloudflare builds your frontend (takes ~1 minute). When done you'll see:
```
Your site is live at: https://docscanner.pages.dev
```

✅ Visit that URL — you should see the full DocScanPro interface.

---

## PART 4 — Verify end-to-end (2 min)

1. Open your Cloudflare Pages URL
2. In the top-right, the status pill should say **"Backend connected"** (green dot)
3. Click **Upload** → drag in any photo of a document
4. Wait ~5 seconds for OCR
5. Click **Structured PDF** → a formatted PDF should download

If the status says "Offline — browser OCR", the `VITE_API_URL` variable wasn't set correctly. Double-check Part 3.4.

---

## Future deploys (automatic)

Every time you push to GitHub:
- **Cloudflare Pages** rebuilds the frontend automatically
- **Railway** rebuilds and redeploys the backend automatically

No manual steps needed.

---

## Troubleshooting

### "Backend connected" but PDF export fails
Check Railway deploy logs for Python errors. Most common cause: OCRmyPDF missing a system package. The Dockerfile includes everything — make sure Railway is using the Dockerfile (Settings → Builder → select "Dockerfile").

### Build fails on Cloudflare (module not found)
Run locally first:
```bash
cd frontend && npm install && npm run build
```
If it fails locally, fix it there first, then push.

### Railway build stuck / timeout
Free tier has a 2 GB memory limit. The Tesseract+Ghostscript image is ~800 MB — well within limits. If it times out, click **Redeploy** in the Railway dashboard.

### OCR returns empty text
The image may be too low resolution. Tesseract works best at 200+ DPI. Try a clearer photo or scan.

---

## Your URLs (fill these in)

| Service | URL |
|---------|-----|
| GitHub repo | `https://github.com/YOUR_USERNAME/docscanner` |
| Railway API | `https://docscanner-production-xxxx.up.railway.app` |
| Live site | `https://docscanner.pages.dev` |
| API health | `https://docscanner-production-xxxx.up.railway.app/api/health` |
| API docs | `https://docscanner-production-xxxx.up.railway.app/docs` |
