#!/usr/bin/env node

/**
 * Onboarding Playbook Agent — SOW Generator
 * Generate Statement of Work (SOW) from timeline and discovery
 */

const fs = require('fs');

/**
 * Generate Statement of Work
 * @param {Object} timeline - Timeline object (from create-timeline.js)
 * @param {Object} discovery - Discovery object
 * @param {Object} options - SOW options
 * @returns {string} Formatted SOW document
 */
function generateSOW(timeline, discovery, options = {}) {
  const defaultRate = options.rate || 400;
  const specialRate = options.special_rate || 100; // 6x discount for nonprofits/strategic
  const useSpecialRate = options.use_special_rate || false;
  
  const rate = useSpecialRate ? specialRate : defaultRate;

  let sow = '';

  // Header
  sow += `# STATEMENT OF WORK (SOW)\n\n`;
  sow += `**Project:** ${discovery.client_name} — ${discovery.initiative || 'Initiative'}\n`;
  sow += `**Prepared:** ${new Date().toISOString().split('T')[0]}\n`;
  sow += `**Duration:** 6 weeks (${timeline.start_date} to ${timeline.end_date})\n\n`;

  // Executive Summary
  sow += `## 1. EXECUTIVE SUMMARY\n\n`;
  sow += `This Statement of Work outlines the engagement for ${discovery.client_name} over a 6-week period.\n\n`;
  sow += `**Key Deliverables:**\n`;
  const allDeliverables = [];
  for (const phase of Object.values(timeline.phases)) {
    phase.deliverables.forEach(d => allDeliverables.push(d));
  }
  allDeliverables.slice(0, 10).forEach(d => {
    sow += `- ${d}\n`;
  });
  sow += `\n`;

  // Scope of Work
  sow += `## 2. SCOPE OF WORK\n\n`;
  
  for (const [key, phase] of Object.entries(timeline.phases).sort()) {
    sow += `### Phase ${key.split('_')[0]}: ${phase.name} (Weeks ${phase.weeks})\n\n`;
    
    sow += `**Objectives:**\n`;
    phase.objectives.forEach(obj => {
      sow += `- ${obj}\n`;
    });
    
    sow += `\n**Deliverables:**\n`;
    phase.deliverables.forEach(del => {
      sow += `- ${del}\n`;
    });
    
    sow += `\n**Team Effort:**\n`;
    sow += `- Josh (Fractional CTO): ${phase.team_effort.josh}\n`;
    sow += `- Omega (Execution): ${phase.team_effort.omega}\n`;
    
    sow += `\n**Success Criteria:**\n`;
    phase.success_criteria.forEach(crit => {
      sow += `- ${crit}\n`;
    });
    
    sow += `\n`;
  }

  // Timeline
  sow += `## 3. PROJECT TIMELINE\n\n`;
  sow += `| Phase | Duration | Start Date | End Date | Key Milestone |\n`;
  sow += `|-------|----------|-----------|----------|---------------|\n`;
  
  for (const [key, phase] of Object.entries(timeline.phases).sort()) {
    const milestone = timeline.milestones.find(m => m.phase === parseInt(key[0]));
    sow += `| ${phase.name} | ${phase.weeks} weeks | ${phase.start_date} | ${phase.end_date} | ${milestone?.title || '—'} |\n`;
  }
  
  sow += `\n`;

  // Decision Gates
  sow += `## 4. DECISION GATES\n\n`;
  sow += `The following decision gates must be completed to advance to the next phase:\n\n`;
  
  timeline.decision_gates.forEach((gate, idx) => {
    sow += `### Gate ${idx + 1}: Week ${gate.week} — ${gate.gate}\n\n`;
    sow += `**Required for:** ${gate.required_for}\n\n`;
    sow += `**Decision Makers:** ${gate.decision_makers.join(', ')}\n\n`;
    sow += `**Approval Criteria:**\n`;
    gate.criteria.forEach(crit => {
      sow += `- ☐ ${crit}\n`;
    });
    sow += `\n`;
  });

  // Pricing
  sow += `## 5. PRICING & PAYMENT\n\n`;
  
  const joshTotal = timeline.resource_allocation.total_hours.josh * defaultRate;
  const omegaTotal = timeline.resource_allocation.total_hours.omega * rate;
  const grossTotal = joshTotal + omegaTotal;
  
  sow += `### Engagement Model: Tranched Delivery\n\n`;
  sow += `This project is divided into three tranches with separate SOWs and approval gates:\n\n`;
  
  // Calculate tranche amounts
  const tranche1 = grossTotal * 0.10; // 10%
  const tranche2 = grossTotal * 0.65; // 65%
  const tranche3 = grossTotal * 0.25; // 25%
  
  sow += `| Tranche | Phase | Deliverables | Amount | Schedule |\n`;
  sow += `|---------|-------|--------------|--------|----------|\n`;
  sow += `| 1 | Discovery (Week 1-2) | Discovery doc, proposal | $${Math.round(tranche1).toLocaleString()} | Due Week 2 |\n`;
  sow += `| 2 | Build & Pilot (Week 3-6) | Architecture, data model, pilot setup | $${Math.round(tranche2).toLocaleString()} | Due Week 6 |\n`;
  sow += `| 3 | Ongoing Support (post-launch) | Training, runbook, post-launch support | $${Math.round(tranche3).toLocaleString()} | Months 2-6 |\n\n`;

  // Rate justification
  if (useSpecialRate) {
    const savings = (defaultRate - specialRate) * timeline.resource_allocation.total_hours.omega;
    sow += `### Special Client Rate\n\n`;
    sow += `This engagement uses a **special rate of $${specialRate}/hour** (vs. standard $${defaultRate}/hour) in support of ${discovery.client_name}'s mission.\n\n`;
    sow += `**Contribution-in-Kind Calculation:**\n`;
    sow += `- Standard rate: $${defaultRate}/hr × ${timeline.resource_allocation.total_hours.omega} hours = $${Math.round(defaultRate * timeline.resource_allocation.total_hours.omega).toLocaleString()}\n`;
    sow += `- Special rate: $${specialRate}/hr × ${timeline.resource_allocation.total_hours.omega} hours = $${Math.round(omegaTotal).toLocaleString()}\n`;
    sow += `- **Contribution-in-Kind: $${Math.round(savings).toLocaleString()}** (tax-deductible)\n\n`;
  }

  sow += `### Cost Breakdown\n\n`;
  sow += `| Role | Hours | Rate | Amount |\n`;
  sow += `|------|-------|------|--------|\n`;
  sow += `| Josh (Fractional CTO) | ${timeline.resource_allocation.total_hours.josh} | $${defaultRate}/hr | $${Math.round(joshTotal).toLocaleString()} |\n`;
  sow += `| Omega (Execution) | ${timeline.resource_allocation.total_hours.omega} | $${rate}/hr | $${Math.round(omegaTotal).toLocaleString()} |\n`;
  sow += `| **Total** | — | — | **$${Math.round(grossTotal).toLocaleString()}** |\n\n`;

  // Payment Terms
  sow += `### Payment Terms\n\n`;
  sow += `- **Invoice Schedule:** At completion of each tranche\n`;
  sow += `- **Payment Due:** Net 30 from invoice date\n`;
  sow += `- **Late Payment:** 1.5% monthly interest on overdue amounts\n`;
  sow += `- **Expense Reimbursement:** Out-of-pocket expenses (travel, tools, etc.) billed separately with receipts\n\n`;

  // Assumptions & Constraints
  sow += `## 6. ASSUMPTIONS & CONSTRAINTS\n\n`;
  sow += `### Assumptions\n`;
  sow += `- Client will provide timely access to key stakeholders and data\n`;
  sow += `- Client will designate a primary point of contact for decisions\n`;
  sow += `- All discovery interviews will be completed by end of Week 1\n`;
  sow += `- Client infrastructure and credentials will be available as needed\n`;
  sow += `- Required compliance reviews (if any) will be scheduled in Phase 2\n\n`;

  sow += `### Constraints\n`;
  sow += `- Scope is fixed; additional work will be quoted separately\n`;
  sow += `- Timeline assumes availability of key decision makers at scheduled gates\n`;
  sow += `- This engagement covers design, documentation, and implementation guidance\n`;
  sow += `- Client team training is included; ongoing managed services are out of scope\n\n`;

  // Terms & Conditions
  sow += `## 7. TERMS & CONDITIONS\n\n`;
  sow += `- **Confidentiality:** All client information is confidential\n`;
  sow += `- **Intellectual Property:** Deliverables are owned by client; methodologies and templates remain our IP\n`;
  sow += `- **Liability:** Limited to amount paid in this SOW\n`;
  sow += `- **Termination:** Either party may terminate with 30 days' notice; payment for work completed due upon termination\n`;
  sow += `- **Disputes:** Resolved through mediation, then arbitration under [STATE] law\n\n`;

  // Appendix
  sow += `## APPENDIX: REFERENCE MATERIALS\n\n`;
  sow += `- Discovery Document (SK-3)\n`;
  sow += `- Tech Stack Assessment (SK-4)\n`;
  sow += `- Pain Points Canvas (SK-5)\n`;
  sow += `- Data Model Definition (SK-6)\n`;
  sow += `- Onboarding Playbook (SK-8)\n\n`;

  // Signatures
  sow += `---\n\n`;
  sow += `**SIGNATURES**\n\n`;
  sow += `**For ${discovery.client_name}:**\n\n`;
  sow += `Name: ______________________  Date: __________\n`;
  sow += `Title: ______________________\n\n`;

  sow += `**For Stream Kinetics:**\n\n`;
  sow += `Name: Joshua  Date: __________\n`;
  sow += `Title: Fractional CTO / Venture Partner\n\n`;

  return sow;
}

/**
 * CLI Interface
 */
async function main() {
  const [timelineFile, discoveryFile, args] = process.argv.slice(2);

  if (!timelineFile || !discoveryFile) {
    console.log(`Usage:
  node generate-sow.js <timeline-json> <discovery-json> [options]

Options:
  --special-rate    Use special rate ($100/hr) instead of standard ($400/hr)
  --output <file>   Write to file instead of stdout

Examples:
  node generate-sow.js timeline.json discovery.json
  node generate-sow.js timeline.json discovery.json --special-rate
  node generate-sow.js timeline.json discovery.json --output sow.md

Output:
  Formatted SOW document (Markdown)
`);
    process.exit(1);
  }

  try {
    console.error(`📄 Generating Statement of Work...\n`);
    
    const timeline = JSON.parse(fs.readFileSync(timelineFile, 'utf-8'));
    const discovery = JSON.parse(fs.readFileSync(discoveryFile, 'utf-8'));
    
    const useSpecialRate = process.argv.includes('--special-rate');
    
    const sowContent = generateSOW(timeline, discovery, { use_special_rate: useSpecialRate });
    
    // Output
    const outputFile = process.argv.find((arg, idx) => arg === '--output' && process.argv[idx + 1]);
    const outputPath = process.argv[process.argv.indexOf('--output') + 1];
    
    if (outputPath) {
      fs.writeFileSync(outputPath, sowContent);
      console.error(`✅ SOW written to ${outputPath}`);
    } else {
      console.log(sowContent);
    }

  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  generateSOW
};
