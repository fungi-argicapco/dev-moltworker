---
name: cloudflare-security-agent
model_tier: light
description: Comprehensive Cloudflare security auditing, compliance assessment, and hardening recommendations. Use when evaluating account security posture, identifying vulnerabilities, checking API token exposure, validating encryption/access controls, or generating security compliance reports.
---

# Cloudflare Security Agent

Autonomous security auditing and advisory for Cloudflare accounts.

## Core Operations

### Account Security Audit
- API token inventory (expiration, scope, usage patterns)
- Zone configuration review (DNSSEC, TLS version, security headers)
- Firewall rules and WAF policies
- DDoS protection settings
- Rate limiting configuration
- Bot management status

### Data Security
- D1 database encryption (at rest + in transit)
- D1 access control lists (who can read/write)
- R2 bucket policies and lifecycle rules
- KV namespace access controls
- Stream video privacy settings
- Backup retention and disaster recovery

### API & Token Security
- Token age and expiration tracking
- Permission scope audit (overly broad scopes)
- Unused or inactive tokens
- Token rotation recommendations
- Audit log analysis for suspicious API calls

### Compliance & Standards
- HIPAA readiness (for healthcare clients like Monique)
- GDPR compliance posture
- SOC 2 readiness assessment
- PCI DSS relevance (if handling payment data)
- Data residency validation

### Infrastructure Hardening
- DDoS threshold optimization
- WAF rule effectiveness
- Rate limit tuning
- Geo-blocking policies
- Worker isolation and permissions
- Page Rules optimization

## Output

All audits generate:
1. **Security Scorecard** — Overall posture (0-100) with breakdown by category
2. **Risk Matrix** — Identified vulnerabilities with severity (critical, high, medium, low)
3. **Recommendations** — Prioritized hardening steps with effort estimate
4. **Compliance Status** — HIPAA/GDPR/SOC2 alignment
5. **Action Plan** — 30/60/90-day security roadmap

## Tools & Scripts

See `scripts/` directory:
- `audit-account.js` - Full security audit
- `check-tokens.js` - API token inventory + risk assessment
- `check-d1-security.js` - D1 database audit
- `check-firewall.js` - Firewall/WAF/DDoS review
- `compliance-check.js` - HIPAA/GDPR/SOC2 assessment
- `generate-report.js` - Formatted security report

## Integration Points

- **Linear:** Store audit results as issues for tracking/remediation
- **Cron:** Schedule weekly/monthly security scans
- **Notifications:** Alert on critical findings

## Key Models

- **Cloudflare API v4** — Account, zone, database, worker queries
- **Security Standards** — NIST CSF, CIS Benchmarks, OWASP Top 10
- **Risk Scoring** — CVSS-inspired (severity + exploitability + impact)

## Use Cases

- Monthly security hygiene audit
- Compliance readiness for healthcare/finance clients
- Pre-incident response review
- Onboarding security checklist
- Token rotation tracking
- Vulnerability remediation planning
