#!/usr/bin/env node

/**
 * Integration Architect — Compliance Audit
 * HIPAA, GDPR, and other regulatory compliance assessment
 */

const fs = require('fs');

/**
 * Run compliance audit
 * @param {Object} discovery - Discovery object
 * @returns {Object} Compliance audit report
 */
function runComplianceAudit(discovery) {
  const audit = {
    audited_at: new Date().toISOString(),
    client_name: discovery.client_name,
    initiative: discovery.initiative,
    applicable_regulations: [],
    compliance_scores: {},
    gaps: [],
    recommendations: [],
    timeline_to_compliance: null,
    certification_status: {}
  };

  // Determine applicable regulations
  audit.applicable_regulations = determineApplicableRegulations(discovery);

  // Run specific compliance checks
  audit.compliance_scores = {};
  audit.gaps = [];

  for (const regulation of audit.applicable_regulations) {
    const check = runComplianceCheck(regulation, discovery);
    audit.compliance_scores[regulation] = check.score;
    audit.gaps.push(...check.gaps);
    audit.recommendations.push(...check.recommendations);
  }

  // Prioritize recommendations
  audit.recommendations.sort((a, b) => {
    const severityMap = { critical: 0, high: 1, medium: 2, low: 3 };
    return severityMap[a.severity] - severityMap[b.severity];
  });

  // Build timeline to compliance
  audit.timeline_to_compliance = buildComplianceTimeline(audit);

  // Set certification status
  audit.certification_status = {
    current: 'Non-compliant',
    target: audit.applicable_regulations.length > 0 ? 'Compliant' : 'N/A',
    estimated_completion: audit.timeline_to_compliance?.estimated_completion
  };

  return audit;
}

/**
 * Determine which regulations apply
 */
function determineApplicableRegulations(discovery) {
  const regulations = [];
  const allText = JSON.stringify(discovery).toLowerCase();

  // Healthcare check
  if (allText.includes('patient') || allText.includes('medical') || 
      allText.includes('health') || allText.includes('therapist') || 
      allText.includes('psychology') || allText.includes('doctor')) {
    regulations.push('HIPAA');
  }

  // EU data check
  if (allText.includes('european') || allText.includes('eu') || 
      allText.includes('gdpr') || (discovery.team_context?.industry || '').includes('Europe')) {
    regulations.push('GDPR');
  }

  // Payment processing check
  if (allText.includes('payment') || allText.includes('credit card') || 
      allText.includes('pci')) {
    regulations.push('PCI DSS');
  }

  // Service provider check
  if (allText.includes('service provider') || allText.includes('soc 2')) {
    regulations.push('SOC 2');
  }

  // Default: recommend data privacy best practices
  if (regulations.length === 0) {
    regulations.push('General Data Privacy');
  }

  return regulations;
}

/**
 * Run specific compliance check
 */
function runComplianceCheck(regulation, discovery) {
  const checks = {
    'HIPAA': checkHIPAA,
    'GDPR': checkGDPR,
    'PCI DSS': checkPCIDSS,
    'SOC 2': checkSOC2,
    'General Data Privacy': checkGeneralPrivacy
  };

  const checkFn = checks[regulation] || checkGeneralPrivacy;
  return checkFn(discovery);
}

/**
 * HIPAA Compliance Check
 * Applies to: Healthcare providers, health plans, healthcare clearinghouses
 */
function checkHIPAA(discovery) {
  const result = {
    regulation: 'HIPAA',
    score: 0,
    gaps: [],
    recommendations: [],
    requirements: {}
  };

  const checks = {
    'Access Controls': {
      required: true,
      description: 'User authentication, authorization, audit logging',
      implemented: false
    },
    'Data Encryption': {
      required: true,
      description: 'Encryption at rest (AES-256) and in transit (TLS 1.2+)',
      implemented: false
    },
    'Audit Logs': {
      required: true,
      description: '6-year retention of access logs, modifications, deletions',
      implemented: false
    },
    'Business Associate Agreement': {
      required: true,
      description: 'BAA with all vendors handling PHI',
      implemented: false
    },
    'Breach Notification': {
      required: true,
      description: 'Procedures to notify individuals if PHI is breached',
      implemented: false
    },
    'Data Integrity': {
      required: true,
      description: 'Mechanisms to ensure PHI has not been altered',
      implemented: false
    },
    'Minimum Necessary': {
      required: true,
      description: 'Only access minimum PHI needed for purpose',
      implemented: false
    },
    'Secure Communication': {
      required: true,
      description: 'Encrypted communication channels for PHI',
      implemented: false
    }
  };

  // Score implementation status
  let implementedCount = 0;
  for (const [requirement, details] of Object.entries(checks)) {
    result.requirements[requirement] = details;
    
    // Simple heuristic: check if tech stack supports
    const techStack = JSON.stringify(discovery.tech_stack || {}).toLowerCase();
    const isImplemented = techStack.includes('encrypt') || 
                         techStack.includes('postgres') ||
                         techStack.includes('cloudflare');
    
    if (isImplemented) implementedCount++;
    
    if (!isImplemented && details.required) {
      result.gaps.push({
        requirement,
        severity: 'critical',
        description: details.description,
        current_state: 'Not implemented'
      });
    }
  }

  result.score = Math.round((implementedCount / Object.keys(checks).length) * 100);

  // Generate recommendations
  result.recommendations = [
    {
      severity: 'critical',
      item: 'Implement end-to-end encryption',
      description: 'All patient data must be encrypted at rest (AES-256) and in transit (TLS 1.2+)',
      effort: '40 hours',
      timeline: '2 weeks'
    },
    {
      severity: 'critical',
      item: 'Establish audit logging',
      description: 'Implement 6-year audit log retention for all PHI access and modifications',
      effort: '30 hours',
      timeline: '2 weeks'
    },
    {
      severity: 'critical',
      item: 'Vendor BAA agreements',
      description: 'Execute Business Associate Agreements with all vendors (hosting, analytics, etc.)',
      effort: '10 hours',
      timeline: '1 week'
    },
    {
      severity: 'high',
      item: 'Access control framework',
      description: 'Role-based access control (RBAC) with MFA',
      effort: '20 hours',
      timeline: '1 week'
    },
    {
      severity: 'high',
      item: 'Breach notification procedures',
      description: 'Document and test breach notification procedures',
      effort: '8 hours',
      timeline: '3 days'
    }
  ];

  return result;
}

/**
 * GDPR Compliance Check
 * Applies to: Any organization processing EU resident data
 */
function checkGDPR(discovery) {
  const result = {
    regulation: 'GDPR',
    score: 0,
    gaps: [],
    recommendations: [],
    requirements: {}
  };

  const checks = {
    'Lawful Basis': {
      required: true,
      description: 'Documented legal basis for processing (consent, contract, legal obligation, etc.)'
    },
    'Privacy Policy': {
      required: true,
      description: 'Clear, transparent privacy policy in plain language'
    },
    'Consent Management': {
      required: true,
      description: 'Explicit opt-in consent (not pre-checked), easy opt-out'
    },
    'Data Subject Rights': {
      required: true,
      description: 'Right to access, rectification, erasure, portability, objection'
    },
    'Data Processing Agreement': {
      required: true,
      description: 'DPA with all processors (vendors, subcontractors)'
    },
    'Data Protection Impact Assessment': {
      required: false,
      description: 'DPIA for high-risk processing'
    },
    'Data Protection Officer': {
      required: false,
      description: 'Appoint DPO if public body or systematic monitoring'
    },
    'Breach Notification (72h)': {
      required: true,
      description: 'Notify regulators within 72 hours of breach discovery'
    }
  };

  let implementedCount = 0;
  for (const [requirement, details] of Object.entries(checks)) {
    result.requirements[requirement] = details;
    
    // Simple check
    const isImplemented = false; // Default to not implemented without explicit indication
    if (isImplemented) implementedCount++;
    
    if (!isImplemented && details.required) {
      result.gaps.push({
        requirement,
        severity: 'critical',
        description: details.description,
        current_state: 'Not implemented'
      });
    }
  }

  result.score = 20; // Very low unless explicitly implemented

  result.recommendations = [
    {
      severity: 'critical',
      item: 'Document lawful basis for processing',
      description: 'Identify and document the legal basis (consent, contract, etc.) for each processing activity',
      effort: '16 hours',
      timeline: '1 week'
    },
    {
      severity: 'critical',
      item: 'Create/update privacy policy',
      description: 'Transparent, clear, comprehensive privacy policy covering all processing',
      effort: '20 hours',
      timeline: '2 weeks'
    },
    {
      severity: 'critical',
      item: 'Implement consent management',
      description: 'System to capture, manage, and honor GDPR-compliant consent',
      effort: '30 hours',
      timeline: '2 weeks'
    },
    {
      severity: 'high',
      item: 'Execute Data Processing Agreements',
      description: 'DPA with all vendors processing EU data (processors)',
      effort: '12 hours',
      timeline: '1 week'
    },
    {
      severity: 'medium',
      item: 'Conduct DPIA (if high-risk)',
      description: 'Data Protection Impact Assessment for systematic monitoring or special categories',
      effort: '24 hours',
      timeline: '2 weeks'
    }
  ];

  return result;
}

/**
 * PCI DSS Compliance Check
 * Applies to: Any organization handling payment card data
 */
function checkPCIDSS(discovery) {
  const result = {
    regulation: 'PCI DSS',
    score: 0,
    gaps: [],
    recommendations: [
      {
        severity: 'critical',
        item: 'Never store full card data',
        description: 'Use tokenization or payment processor APIs; never store card numbers',
        effort: 'Varies',
        timeline: '1-4 weeks'
      },
      {
        severity: 'critical',
        item: 'Encrypted transmission',
        description: 'All card data transmitted over TLS 1.2+ (never HTTP)'
      },
      {
        severity: 'high',
        item: 'Qualified security assessor',
        description: 'Annual assessment by QSA if processing >6M transactions/year'
      }
    ]
  };

  result.score = 0;
  return result;
}

/**
 * SOC 2 Compliance Check
 * Applies to: Service providers and outsourced service providers
 */
function checkSOC2(discovery) {
  const result = {
    regulation: 'SOC 2',
    score: 0,
    gaps: [],
    recommendations: [
      {
        severity: 'high',
        item: 'Security controls assessment',
        description: 'Evaluate and document controls for availability, processing integrity, confidentiality, privacy',
        effort: '40 hours',
        timeline: '3-4 weeks'
      },
      {
        severity: 'high',
        item: 'Audit readiness program',
        description: 'Implement controls and document evidence for Type I or Type II audit',
        effort: '60 hours',
        timeline: '6-8 weeks'
      }
    ]
  };

  result.score = 0;
  return result;
}

/**
 * General Data Privacy Best Practices
 */
function checkGeneralPrivacy(discovery) {
  const result = {
    regulation: 'General Data Privacy',
    score: 30,
    gaps: [],
    recommendations: [
      {
        severity: 'high',
        item: 'Data encryption',
        description: 'Encrypt all sensitive data at rest and in transit'
      },
      {
        severity: 'high',
        item: 'Access controls',
        description: 'Implement user authentication, authorization, audit logging'
      },
      {
        severity: 'medium',
        item: 'Privacy policy',
        description: 'Clear, transparent privacy policy covering data use'
      },
      {
        severity: 'medium',
        item: 'Data retention policy',
        description: 'Define how long data is retained and when it is deleted'
      }
    ]
  };

  return result;
}

/**
 * Build compliance timeline
 */
function buildComplianceTimeline(audit) {
  const criticalGaps = audit.gaps.filter(g => g.severity === 'critical').length;
  const highGaps = audit.gaps.filter(g => g.severity === 'high').length;

  let estimatedWeeks = 1 + (criticalGaps * 2) + (highGaps * 1);

  return {
    phase_1: '0-1 weeks — Assessment and planning',
    phase_2: `1-${estimatedWeeks} weeks — Implementation of critical and high-priority gaps`,
    phase_3: `${estimatedWeeks}-${estimatedWeeks + 2} weeks — Testing and verification`,
    phase_4: `${estimatedWeeks + 2}-${estimatedWeeks + 4} weeks — Audit readiness and certification`,
    estimated_completion: `${estimatedWeeks + 4} weeks`,
    concurrent_work: 'Many items can be parallelized'
  };
}

/**
 * CLI Interface
 */
async function main() {
  const [discoveryFile] = process.argv.slice(2);

  if (!discoveryFile) {
    console.log(`Usage:
  node compliance-audit.js <discovery-json>

Input:
  Discovery JSON object

Output:
  Compliance audit report (JSON)

Example:
  node compliance-audit.js discovery.json
`);
    process.exit(1);
  }

  try {
    const discovery = JSON.parse(fs.readFileSync(discoveryFile, 'utf-8'));
    
    console.error(`🔍 Running compliance audit for ${discovery.client_name}...\n`);
    
    const audit = runComplianceAudit(discovery);
    
    console.log(JSON.stringify(audit, null, 2));
    
    console.error(`\n✅ Audit complete!`);
    console.error(`  Applicable regulations: ${audit.applicable_regulations.join(', ')}`);
    console.error(`  Critical gaps: ${audit.gaps.filter(g => g.severity === 'critical').length}`);
    console.error(`  Recommendations: ${audit.recommendations.length}\n`);

  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  runComplianceAudit,
  determineApplicableRegulations,
  checkHIPAA,
  checkGDPR,
  checkPCIDSS
};
