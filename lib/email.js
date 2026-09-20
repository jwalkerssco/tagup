/* email.js -- outbound mail for verification, reset and invite links.

   Postmark over its HTTPS API with no SDK (one fetch), the same provider
   The Standard already trusts for inbound. With no POSTMARK_TOKEN the
   sender logs the link to the console -- so a fresh checkout works on day
   one and a developer can copy the verification link out of the log. That
   fallback is REPORTED as such (mode:"console") so a production deploy
   missing the token is visible on /api/health rather than silently
   swallowing every signup's verification mail.                            */
"use strict";

function create(env, fetchFn) {
  const token = env.POSTMARK_TOKEN || "";
  const from = env.MAIL_FROM || "tagup <hello@tagup.app>";
  const mode = token ? "postmark" : "console";
  const f = fetchFn || (typeof fetch === "function" ? fetch : null);

  function html(subject, url, intro) {
    return "<div style=\"font-family:Inter,system-ui,sans-serif;max-width:520px;margin:0 auto;padding:32px 20px;color:#14110F\">" +
      "<div style=\"display:flex;align-items:center;gap:10px;margin-bottom:24px\"><span style=\"display:inline-block;width:28px;height:28px;background:#FF6A13;border-radius:6px\"></span><span style=\"font-weight:800;font-size:22px\">tagup</span></div>" +
      "<h2 style=\"margin:0 0 8px;font-size:20px\">" + subject + "</h2>" +
      "<p style=\"color:#3D4450;line-height:1.5\">" + intro + "</p>" +
      "<p style=\"margin:24px 0\"><a href=\"" + url + "\" style=\"display:inline-block;background:#FF6A13;color:#14110F;font-weight:700;text-decoration:none;padding:12px 20px;border-radius:10px\">Open tagup</a></p>" +
      "<p style=\"color:#9AA6B6;font-size:12px\">Or paste this into your browser:<br>" + url + "</p>" +
      "<p style=\"color:#9AA6B6;font-size:12px;margin-top:32px\">Prices today. On shelf tomorrow.</p></div>";
  }
  const INTRO = {
    verify: "Confirm this address and you're in. The link works once.",
    reset: "Choose a new password. This link expires in an hour, and it only works once.",
    invite: "You've been invited to a team on tagup, where reps request price tags and the sign shop prints them. Accept to set your password and get started.",
  };
  function kindOf(subject) { return /verify/i.test(subject) ? "verify" : /reset/i.test(subject) ? "reset" : "invite"; }

  async function send(to, subject, url) {
    if (mode === "console" || !f) { console.log("[email:" + mode + "] to=" + to + " subject=" + JSON.stringify(subject) + " url=" + url); return { ok: true, mode: "console" }; }
    try {
      const r = await f("https://api.postmarkapp.com/email", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", "X-Postmark-Server-Token": token },
        body: JSON.stringify({ From: from, To: to, Subject: subject, HtmlBody: html(subject, url, INTRO[kindOf(subject)]), TextBody: subject + "\n\n" + url, MessageStream: "outbound" }),
      });
      if (!r.ok) { const t = await r.text().catch(() => ""); console.error("[email] postmark " + r.status + " " + t.slice(0, 200)); return { ok: false, mode, status: r.status }; }
      return { ok: true, mode };
    } catch (e) { console.error("[email] send failed:", e && e.message); return { ok: false, mode, error: String((e && e.message) || e) }; }
  }
  return { send, mode };
}
module.exports = { create };
