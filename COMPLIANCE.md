# Resizo — internal compliance note

Internal working note for the operator. **Not published, not legal advice.** It records
what data Resizo handles, who processes it, how long it is kept, the outstanding
decisions only a human can make, and a breach register to fill in if something goes
wrong. Keep it up to date; a regulator asks for the record of processing and the breach
register first.

Last reviewed: 2026-08-11

---

## 1. Who we are

Resizo is run by one individual (Sucheet Boppana). Resizo is the **controller** for the
personal data below. Being an individual does not remove controller duties, and it
removes one shelter: because the processing is regular rather than "occasional", the
Article 30(5) exemption from keeping a record of processing does **not** apply — this
document is that record.

---

## 2. Processors (and the contracts to keep on file)

Each of these processes personal data on Resizo's behalf under a written data-processing
agreement (GDPR Art. 28). Accept/download each DPA and store a copy next to this file.

| Processor | What it does for us | Data it holds | DPA to accept and keep |
| --- | --- | --- | --- |
| Vercel | Runs the app and the image-processing functions; keeps short-lived request logs | Request logs (timestamp, path, status, IP, user agent) | https://vercel.com/legal/dpa |
| Supabase | Database + authentication | Login (email, password hash or Google profile), resize-history rows, reviews | https://supabase.com/legal/dpa (plus their Transfer Impact Assessment) |
| Upstash | Redis for rate limiting | IP address as a short-lived counter key | https://upstash.com/static/trust/dpa.pdf |

**Google (AdSense) is not a processor.** For advertising it is an **independent
controller** of the ad data it collects, so it is not on this list and not covered by a
DPA with us.

International transfers: all three are US-headquartered. The safeguard is the Standard
Contractual Clauses (plus UK Addendum) inside each DPA, and — where the provider is also
certified — the EU–US Data Privacy Framework and its UK extension. Rely on the SCCs as
the primary mechanism, with DPF as an additional layer.

---

## 3. Record of processing / retention

One row per class of personal data. Retention is the real number, not "a short window".

| # | Data class | Subjects | Purpose | Lawful basis | Recipients | Transfer safeguard | Retention |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Uploaded image bytes | Uploader + anyone depicted | Run the requested operation | Contract (service requested) | Vercel (transient) | SCCs / DPF | One HTTP request; nothing persisted |
| 2 | IP address (rate-limit key) | Visitor | Prevent abuse, keep the free service up | Legitimate interests | Upstash | SCCs / DPF | ~1 minute (counter clears) |
| 3 | Account identity (email, password hash, or Google name/email/avatar URL) | Account holder | Provide the account | Contract | Supabase | SCCs / DPF | Until the user deletes the account |
| 4 | Resize-history rows (filename, dimensions, formats, sizes, timestamps) | Account holder | Show history/savings | Contract | Supabase | SCCs / DPF | Until the user deletes it |
| 5 | Public review (name, role, text, rating, date, linked account) | Reviewer | Publish reviews | Consent | Supabase | SCCs / DPF | Until the user deletes it / asks for takedown |
| 6 | Server request logs (timestamp, path, status, IP, user agent) | Visitor | Diagnose faults and abuse | Legitimate interests | Vercel | SCCs / DPF | Vercel's plan window (~1 day — confirm exact figure) |
| 7 | Advertising identifiers/cookies | Visitor who consents | Serve/measure ads | Consent | Google (independent controller) | Google's own | Held by the consent tool (~up to 13 months — confirm) |

Security measures (the short version a regulator will ask for): HTTPS in transit;
encryption at rest by the providers; access to the account database limited to the
operator; rate limiting; no image ever written to disk.

Deletion note: the in-app **Delete account** button must also remove the Supabase **auth**
record, not only the application rows. Verify the delete path calls the auth-admin delete
so no orphan login is left behind — a promise of erasure that leaves an auth row is the
classic failure.

---

## 4. Position notes (why we are/aren't in scope) — re-check as we grow

- **CCPA/CPRA:** not a "business" today — nowhere near the revenue threshold. Not
  structurally exempt: a sole proprietorship is covered, and personalised AdSense to
  Californians counts as "sharing". Re-run the test if California sessions approach
  100,000/year or AdSense revenue becomes material.
- **DSA:** the reviews feature makes Resizo a **hosting** service (Arts. 16–18 apply:
  notice-and-action, statement of reasons, threat-to-life reporting). It is arguably not
  an "online platform" (Arts. 20–28) because reviews are a minor, purely ancillary
  feature, and micro-enterprise status (Art. 19) reaches the same result. Confirm with
  counsel if certainty is wanted; low stakes given the Art. 19 backstop.
- **UK Online Safety Act:** reviews sit inside the Schedule 1 para 4 exemption because
  users can only post one-way reviews on our content. **This ends** the moment users can
  reply to each other, share galleries, or post public links — that would switch on
  Ofcom duties. Re-check before shipping any social feature.
- **US image-tool safe harbours:** images are transient (volitional-conduct doctrine — an
  automatic pipe is not a direct infringer; a transient copy is not "fixed"), so a DMCA
  takedown about an image cannot be actioned. Only stored reviews carry the DMCA /
  § 512(c) obligations.

---

## 5. Outstanding decisions (only a human can make these)

Each of these is cited in the report handed back with this work and is a real decision,
not a drafting gap. Nothing here should be read as "we are legally compliant".

1. **Country of establishment** — set it in the privacy policy masthead and terms §3. It
   drives items 2, 3 and 6 below. (GDPR Art. 13(1)(a).)
2. **EU representative (Art. 27)** and **UK representative** — likely required if the
   operator is not established there, because the processing is not "occasional". Appoint
   and name them in the policy, or record a documented decision to accept the risk.
3. **UK ICO data protection fee** — if UK-established, self-assess and pay (tier 1, £52).
4. **Governing law and courts** — terms §18 is a marked placeholder; set with advice
   (Rome I Art. 6(2); Brussels Ia Arts. 17–19 — consumers keep their home forum).
5. **DSA legal representative (Art. 13)** — needed only if Resizo has a "substantial
   connection to the Union"; English-only with no EU-targeted marketing argues against.
   Lawyer call before publishing EU-facing text.
6. **India IT Rules 2021** — apply only if the operator is India-resident; if so, a named
   Grievance Officer with a 24-hour/15-day service level is required (not yet in the ToS).
7. **NCMEC / CyberTipline (18 U.S.C. § 2258A)** — lawyer call on whether Resizo is a
   "provider"; if yes, register at report.cybertip.org. Do not promise to scan or monitor.
8. **Role email forwarders** — create privacy@, contact@, abuse@, dmca@, security@,
   legal@ on resizo.net and forward to the inbox **before** these documents ship, or the
   published addresses bounce (weakens the GDPR transparency and DSA/DMCA positions).
9. **AdSense dashboard** — turn on the certified CMP (Privacy & messaging › European
   regulations, "Consent / Do not consent / Manage options" layout, Reject as easy as
   Accept); register /privacy as the policy URL; confirm ads.txt shows verified.
10. **Confirm the two retention figures** marked "confirm" in the table above (Vercel log
    window; consent-record retention) and update /privacy if they differ.

---

## 6. Breach register (GDPR Art. 33(5))

Fill in one row per incident — **every** breach, even ones you decide not to report. The
written reason for *not* notifying is the part an authority will ask for. No one-stop-shop
applies (non-EU controller), so a breach touching users in several EU countries means a
separate notification to each country's authority, plus the UK ICO separately, each inside
72 hours of becoming aware.

Seed row records that the artefact exists; replace/append for real incidents.

| ID | Detected (date/time) | How detected | Breach occurred (date/time) | Data affected | Approx. subjects | Likely consequences | Risk (none / risk / high) | Notified DPA? (which + when) | Notified users? (when) | Remedial action | If NOT notified: written reason |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0000 | — | — | — | — | 0 | — | none | No | No | No incidents to date | N/A |

When an incident happens:

1. Contain — roll back the bad deploy; rotate Supabase, Upstash and Vercel keys/secrets;
   rotate the JWT secret to invalidate sessions.
2. Preserve evidence — pull Vercel and Supabase logs **before** rotating anything.
3. Assess risk — is it likely to harm anyone?
4. If risky, notify each affected country's DPA (and the UK ICO) within 72 hours of
   becoming aware; you can file in phases (Art. 33(4)). Tell affected users directly if
   the risk is high (Art. 34).
5. Fill in the row above, including the reasoning if you decide not to notify.
