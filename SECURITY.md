# Security Policy

Resizo is a free image tool maintained by one person. This document explains how to
report a security problem and what to expect back. It is deliberately short and honest:
there is no security team, no bug bounty, and no 24/7 on-call.

## Reporting a vulnerability

Email **security@resizo.net**. Please report privately — do not open a public issue or
post details anywhere public until a fix is out.

A useful report includes:

- what the problem is and where (the URL or the file/endpoint),
- clear steps to reproduce it,
- the impact you think it has, and
- any proof-of-concept you have.

PGP is not currently offered.

## Scope

**In scope:** www.resizo.net, its `/api/*` endpoints, and the published Docker image.

**Out of scope — report these to the vendor directly, not to us:** Vercel, Supabase,
Upstash and Google infrastructure. We run on top of those services and cannot action
reports about them.

## Testing rules (please stay inside these)

Good-faith research that follows these rules is welcome:

- no denial-of-service, volumetric or load testing;
- no automated scanning that degrades the service for other people;
- no social engineering of the maintainer;
- do not access, change or take other users' images or account data — use your own
  test account;
- no physical attacks.

## What to expect

As a solo, part-time maintainer:

- acknowledgement within about 5 business days;
- an initial assessment within about 14 days;
- a fix timeline that depends on severity — I will keep you updated.

I ask for coordinated disclosure: give me a reasonable chance to fix the issue before
you make it public. I am happy to credit you on the fix unless you would rather stay
anonymous.

## Good-faith safe harbour

If you make a good-faith effort to follow this policy, I will not pursue or support
legal action against you for your research, and if someone else brings action against
you for work that followed this policy, I will make it known that it was authorised.
(I am an individual, not a company — I can only speak for myself, not for the
infrastructure providers listed as out of scope.)

## Supported versions

Only the latest `main` and the latest published Docker image are supported. There are
no backported security releases.

| Version | Supported |
| --- | --- |
| latest `main` / latest Docker image | Yes |
| anything older | No |

## Self-hosting

If you run Resizo yourself from the Docker image, patching is your responsibility. Keep
the base image current and keep `sharp` up to date — it decodes untrusted images and is
where image-parser vulnerabilities land. Watch the sharp advisory feed at
https://github.com/lovell/sharp/security/advisories. The image is provided free and
unsupported.
