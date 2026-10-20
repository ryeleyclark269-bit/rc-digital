// Contact form handler (Vercel serverless function).
// Sends website enquiries to RC Digital through Resend.
//
// OFF until these environment variables are set in Vercel
// (Project > Settings > Environment Variables):
//   RESEND_API_KEY  your Resend API key (required - turns the form on)
//   CONTACT_FROM    verified sender, e.g. "RC Digital <enquiries@yourdomain.co.uk>" (required)
//   CONTACT_TO      where enquiries go (optional, defaults to rcdigitaluk@gmail.com)
//
// While RESEND_API_KEY or CONTACT_FROM is missing, this returns 503 "not_configured"
// and the contact page falls back to opening the visitor's email app.

const DEFAULT_TO = "rcdigitaluk@gmail.com";
const LIMITS = { name: 100, business: 120, email: 200, phone: 40, message: 5000, need: 60 };

function clip(value, max) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.CONTACT_FROM;
  const to = process.env.CONTACT_TO || DEFAULT_TO;
  if (!apiKey || !from) {
    return res.status(503).json({ error: "not_configured" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};

  // Hidden field that people never see. Bots fill it in: pretend success and drop it.
  if (clip(body.website, 200)) {
    return res.status(200).json({ ok: true });
  }

  const name = clip(body.name, LIMITS.name);
  const business = clip(body.business, LIMITS.business);
  const email = clip(body.email, LIMITS.email);
  const phone = clip(body.phone, LIMITS.phone);
  const message = clip(body.message, LIMITS.message);
  const needs = (Array.isArray(body.needs) ? body.needs : []).slice(0, 10).map(n => clip(n, LIMITS.need)).filter(Boolean);

  if (!name || !message || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "invalid", message: "Please add your name, a valid email and a few words about your business." });
  }

  const subject = "Website enquiry from " + (business || name);
  const lines = [
    ["Name", name],
    ["Business", business || "-"],
    ["Email", email],
    ["Phone", phone || "-"],
    ["Interested in", needs.length ? needs.join(", ") : "-"],
  ];
  const text = lines.map(([k, v]) => k + ": " + v).join("\n") + "\n\n" + message;
  const html =
    "<h2 style=\"font-family:Arial,sans-serif;color:#0B1A33\">New website enquiry</h2>" +
    "<table style=\"font-family:Arial,sans-serif;font-size:15px;border-collapse:collapse\">" +
    lines.map(([k, v]) => "<tr><td style=\"padding:4px 12px 4px 0;color:#64748B\">" + k + "</td><td style=\"padding:4px 0\"><strong>" + escapeHtml(v) + "</strong></td></tr>").join("") +
    "</table>" +
    "<p style=\"font-family:Arial,sans-serif;font-size:15px;white-space:pre-wrap;margin-top:16px\">" + escapeHtml(message) + "</p>" +
    "<p style=\"font-family:Arial,sans-serif;font-size:13px;color:#64748B\">Sent from the contact form on your website. Press Reply to answer " + escapeHtml(name) + " directly.</p>";

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], reply_to: email, subject, text, html }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      console.error("Resend error", r.status, detail.slice(0, 500));
      return res.status(502).json({ error: "send_failed" });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Resend request failed", err && err.message);
    return res.status(502).json({ error: "send_failed" });
  }
};
