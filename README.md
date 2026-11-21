# cybersecurity247 lead form
Run locally: `node server.js` then open http://localhost:3000 (Node 18+).
Config: copy `.env.example` to `.env` and fill it in. Leads are always saved to data/leads.jsonl (backup + consent record),
then sent to Airtable (table "Clients") and Telegram if configured.
Before going live: replace [LEGAL ENTITY NAME], [NUMBER], [REGISTERED ADDRESS], [ICO NUMBER] in public/privacy.html and terms.html.
Put Caddy or nginx in front for HTTPS (proxy to 127.0.0.1:3000). Rotate access logs after 30 days (the privacy policy promises this).
