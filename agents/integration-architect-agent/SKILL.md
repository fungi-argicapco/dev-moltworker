---
name: integration-architect-agent
description: Assess technology stacks, identify compliance requirements, perform security audits, and recommend integration architecture. Use when evaluating tech choices, ensuring HIPAA/GDPR/compliance, planning integrations, or auditing security posture.
---

# Integration Architect Agent

Autonomous tech stack assessment, compliance auditing, and integration architecture planning.

## Core Operations

### Tech Stack Assessment
- Evaluate current vs. desired technology stacks
- Identify compatibility issues and migration paths
- Recommend replacements or upgrades
- Cost-benefit analysis
- Vendor lock-in assessment

### Compliance & Security Audit
- HIPAA requirements (healthcare)
- GDPR requirements (EU/privacy)
- SOC 2 / ISO 27001 readiness
- Data encryption standards
- Access control assessment
- Security incident response plan

### Integration Architecture
- API assessment and design
- Data flow mapping
- Middleware requirements
- ETL/data integration planning
- System interconnectivity diagram
- Error handling & retry logic

### Risk Assessment
- Security vulnerabilities
- Compliance gaps
- Performance bottlenecks
- Scalability concerns
- Vendor sustainability
- Technical debt analysis

## Tools & Scripts

See `scripts/` directory:
- `assess-tech-stack.js` - Evaluate current/desired tech
- `compliance-audit.js` - HIPAA/GDPR/compliance assessment
- `security-review.js` - Security posture audit
- `integration-design.js` - Integration architecture planning

## Output

All assessments generate:
1. Risk matrix (probability × impact)
2. Recommendations with priority (Critical, High, Medium, Low)
3. Implementation roadmap
4. Resource requirements
5. Success metrics

## Key Frameworks

### Compliance Scope
- **HIPAA:** Healthcare data (applies to doctors, therapists, health apps)
- **GDPR:** EU data protection (applies to EU residents' data)
- **PCI DSS:** Payment card data
- **SOC 2:** Service provider controls
- **ISO 27001:** Information security management

### Integration Patterns
- Batch ETL
- Real-time API integration
- Event-driven streaming
- Message queue processing
- File-based integration

### Security Levels
1. **Level 0:** No security (not acceptable for sensitive data)
2. **Level 1:** Unencrypted over HTTPS (basic)
3. **Level 2:** Encrypted at rest + in transit (standard)
4. **Level 3:** Encrypted + MFA + audit logs (regulated industries)
5. **Level 4:** Level 3 + security incident response + pen testing (critical systems)
