---
"@hexok/email-resend": patch
"@hexok/email-mailgun": patch
"@hexok/sms-twilio": patch
"@hexok/queue-redis": patch
"@hexok/broadcast-redis": patch
"@hexok/schedule-coordinator-redis": patch
"@hexok/logger": patch
"@hexok/logger-sentry": patch
"@hexok/logger-newrelic": patch
"@hexok/quarantine": patch
---

Adapter classes are closed. Wrap one in your own adapter of the port when you need extra logic.
