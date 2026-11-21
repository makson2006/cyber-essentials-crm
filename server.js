// cybersecurity247 lead form server. No dependencies, needs Node 18+.
const http = require('http'), fs = require('fs'), path = require('path');
try { // minimal .env loader
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n').forEach(l => {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
} catch {}
const E = process.env, PORT = E.PORT || 3000;
const LEADS = path.join(__dirname, 'data', 'leads.jsonl');
fs.mkdirSync(path.dirname(LEADS), { recursive: true });

const OPTS = {
  urgency: ['ASAP', 'Within 3 months', 'Within 6 months', 'Over 6 months'],
  ukRegistered: ['Yes', 'No'], firstTime: ['Yes', 'No'],
};
const hits = new Map();
const limited = ip => {
  const now = Date.now(), a = (hits.get(ip) || []).filter(t => now - t < 3600e3);
  a.push(now); hits.set(ip, a); return a.length > 10;
};
const clean = (s, n = 120) => String(s || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, n);
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function validate(b) {
  const d = {
    ukRegistered: clean(b.ukRegistered), firstTime: clean(b.firstTime), priorCert: clean(b.priorCert),
    urgency: clean(b.urgency), name: clean(b.name), company: clean(b.company),
    email: clean(b.email, 254), phone: clean(b.phone, 20),
  };
  for (const k in OPTS) if (!OPTS[k].includes(d[k])) return null;
  d.employees = clean(b.employees);
  if (!['Under 10', '10 - 49', '50 - 249', '250 or more'].includes(d.employees)) return null;
  if (d.firstTime === 'No' && !['Yes', 'No'].includes(d.priorCert)) return null;
  if (d.firstTime === 'Yes') d.priorCert = '';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email)) return null;
  if (d.name.length < 2 || d.company.length < 2) return null;
  if (d.phone.replace(/\D/g, '').length < 10) return null;
  if (b.consent !== true) return null;
  // Government Cyber Essentials First Step Fund (75% off): UK SME (<250 staff), no certificate in last 4 years
  const no = d.ukRegistered !== 'Yes' || d.employees === '250 or more' || (d.firstTime === 'No' && d.priorCert !== 'No');
  d.discount = no ? 'No' : 'Likely';
  return d;
}

async function post(url, headers, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(url.split('/')[2] + ' ' + r.status + ' ' + (await r.text()).slice(0, 300));
}

function toAirtable(l) {
  const f = {
    'Company Name': l.company, 'Contact Name': l.name, 'Email': l.email, 'Phone': l.phone,
    'Employees': l.employees, 'urgency': l.urgency, 'Status': E.AIRTABLE_DEFAULT_STATUS || 'New',
    'Application Date': new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' }),
    'first_time_apply': l.firstTime, 'qualified': l.discount === 'Likely' ? 'Yes' : 'No', 'UK_registered': l.ukRegistered,
  };
  if (E.AIRTABLE_EXTRA_FIELDS === '1') Object.assign(f, { 'Prior Cert': l.priorCert, 'Lead Ref': l.ref, 'Consent': true, 'Consent Time': l.time });
  return post(`https://api.airtable.com/v0/${E.AIRTABLE_BASE_ID}/${encodeURIComponent(E.AIRTABLE_TABLE_NAME || 'Clients')}`,
    { Authorization: 'Bearer ' + E.AIRTABLE_API_KEY }, { records: [{ fields: f }], typecast: true });
}

async function notify(l) {
  const jobs = [];
  if (E.TELEGRAM_BOT_TOKEN && E.TELEGRAM_CHAT_ID) {
    const text = `🔔 <b>New lead ${l.ref}</b>\n${esc(l.name)}, ${esc(l.company)}\n📞 ${esc(l.phone)}\n✉️ ${esc(l.email)}\n👥 ${l.employees} staff\n🇬🇧 UK: ${l.ukRegistered}, first time: ${l.firstTime}\n⏱ ${l.urgency}\n🏷 75% discount: ${l.discount}`;
    jobs.push(post(`https://api.telegram.org/bot${E.TELEGRAM_BOT_TOKEN}/sendMessage`, {}, { chat_id: E.TELEGRAM_CHAT_ID, text, parse_mode: 'HTML' }));
  }
  if (E.AIRTABLE_API_KEY && E.AIRTABLE_BASE_ID) jobs.push(toAirtable(l));
  (await Promise.allSettled(jobs)).forEach(r => console.log(r.status === 'rejected' ? 'notify FAILED: ' + r.reason.message : 'notify ok'));
  if (!jobs.length) console.log('notify: nothing configured (check .env)');
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8' };
const SEC = {
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Strict-Transport-Security': 'max-age=31536000', 'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
};

http.createServer((req, res) => {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  if (req.method === 'POST' && req.url === '/api/lead') {
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 10000) req.destroy(); });
    req.on('end', () => {
      const send = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json', ...SEC }); res.end(JSON.stringify(o)); };
      if (limited(ip)) return send(429, { error: 'Too many requests' });
      let b; try { b = JSON.parse(raw); } catch { return send(400, { error: 'Bad request' }); }
      if (b.website) return send(200, { ref: '0000000000' }); // honeypot: silently drop bots
      const d = validate(b);
      if (!d) return send(400, { error: 'Invalid details' });
      const lead = { ref: String(Date.now()).slice(-6) + String(Math.floor(1000 + Math.random() * 9000)),
        time: new Date().toISOString(), ...d, consent: true };
      fs.appendFileSync(LEADS, JSON.stringify(lead) + '\n'); // local backup first
      notify(lead);
      send(200, { ref: lead.ref });
    });
    return;
  }
  const f = req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0];
  const file = path.join(__dirname, 'public', path.normalize(f));
  if (!file.startsWith(path.join(__dirname, 'public'))) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (e, data) => {
    if (e) { res.writeHead(404, SEC); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', ...SEC });
    res.end(data);
  });
}).listen(PORT, '127.0.0.1', () => console.log('Listening on ' + PORT + ' | Airtable: ' + !!(E.AIRTABLE_API_KEY && E.AIRTABLE_BASE_ID) + ' | Telegram: ' + !!(E.TELEGRAM_BOT_TOKEN && E.TELEGRAM_CHAT_ID)));
