# Md. Hasan Abdullah Masum - Portfolio + Admin Panel

The site is HTML/CSS/JS. All text, sections, menu, footer and Portfolio projects now come from one
content file that you edit in the **admin panel** at `/admin`. Pages are built in the browser from that content,
so what you save in the admin shows on the live site (about 10 seconds later).

## Demo login (change it first)
- Address: `https://your-site.vercel.app/admin`
- ID: `admin`
- Password: `Masum@Demo2026`

Saving is switched off until you change the password (Account page). This stops strangers who read this file
from using the demo login. Password must be at least 10 characters. You can change the ID too.
Forgot the password? In Vercel > Storage > your Blob store, delete the file starting with `admin/auth`.
The login goes back to the demo one.

## What you can do in the admin
- Every page: edit text, buttons, images. Add a section anywhere, move it up/down, hide, duplicate or delete it completely.
- Section types: Hero banner, Text block, Timeline, Image cards, Info cards, Numbered steps, Call to action,
  Portfolio gallery, Contact form, Custom HTML.
- New pages (opened at `page.html?p=name`, can be added to the menu).
- Portfolio projects: unlimited categories, unlimited projects per category, unlimited images per project.
  Images are grouped in slides, and one slide holds 1, 2 or 3 images side by side. Bulk upload picks "images per slide".
- Site settings: name, logo text, menu, header button, footer contacts, social links.
- Contact form: paste your Formspree / Web3Forms URL in the Contact page > Contact form section.
- History: the last 25 saved versions. Load one, check it with Preview, Save to make it live.
- Preview button opens the page with your unsaved edits (only in your browser).
- Big photos are resized in your browser before upload (max 2600 px, WebP), so uploads stay fast and under Vercel's 4.5 MB limit.

## Put it online with Vercel
1. Upload this folder to a GitHub repository (or use the Vercel CLI: `vercel` in this folder).
2. Vercel > Add New Project > import the repository. No build settings needed.
3. In the project: **Storage > Create > Blob** and connect it to the project. This adds `BLOB_READ_WRITE_TOKEN`.
   Without it the admin cannot save.
4. Optional but good: Settings > Environment Variables > add `SESSION_SECRET` (any long random text).
5. Redeploy once (Deployments > Redeploy), open `/admin`, log in, change the password.

Your content and uploaded images live in the Blob store, not in the repository, so a new deployment never wipes your edits.

## Try it on your computer
Needs Node.js 18 or newer (no packages to install):
```
node dev-server.js
```
Open http://localhost:3000 and http://localhost:3000/admin/. Edits are stored in the local `.data` folder only.
Opening `index.html` by double-click still shows the default content, but the admin needs the server above.

## Files
- `js/content-default.js`  the starting content (used until the first save)
- `js/site.js`  builds pages, menu and footer from the content
- `js/portfolio.js`, `js/contact.js`, `js/main.js`  gallery/slider, form, menu and animations
- `admin/`  the admin panel
- `api/`  serverless functions (login, content, image upload)
- `dev-server.js`  local test server
