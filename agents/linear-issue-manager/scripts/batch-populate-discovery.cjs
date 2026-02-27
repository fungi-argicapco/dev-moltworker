#!/usr/bin/env node

/**
 * Batch Populate Discovery Framework Issues
 * Input: JSON discovery object
 * Output: Linked Linear issue hierarchy (SK-2 parent with SK-3 through SK-8 children)
 */

const { createIssue, updateIssue, getTeamByKey } = require('./linear-api.cjs');

/**
 * Populate entire discovery framework
 * @param {Object} discovery - Discovery data object
 * @param {string} discovery.client_name - Client name
 * @param {string} discovery.initiative - Initiative key (CG, MM, WI, FAC, TAR)
 * @param {Object} discovery.tech_stack - Current and desired tech
 * @param {Array} discovery.pain_points - Client pain points
 * @param {Object} discovery.team_context - Client industry, team size, etc.
 * @returns {Promise<Object>} Created issue hierarchy
 */
async function populateDiscoveryFramework(discovery) {
  console.log(`\n📋 Populating Discovery Framework for ${discovery.client_name}...\n`);

  try {
    // Get SK team
    const team = await getTeamByKey('SK');
    if (!team) throw new Error('SK team not found');

    // Create discovery questionnaire (SK-3 parent)
    const sk3 = await createIssue({
      teamId: team.id,
      title: `SK-3: Discovery Questionnaire — ${discovery.client_name}`,
      description: formatDiscoveryQuestionnaire(discovery),
      status: 'TODO'
    });
    console.log(`✅ Created ${sk3.identifier}: Discovery Questionnaire`);

    // Create tech stack matrix (SK-4)
    const sk4 = await createIssue({
      teamId: team.id,
      title: `SK-4: Tech Stack Assessment — ${discovery.client_name}`,
      description: formatTechStackMatrix(discovery.tech_stack),
      parentId: sk3.id,
      status: 'TODO'
    });
    console.log(`✅ Created ${sk4.identifier}: Tech Stack Assessment`);

    // Create pain points canvas (SK-5)
    const sk5 = await createIssue({
      teamId: team.id,
      title: `SK-5: Pain Points & Opportunities — ${discovery.client_name}`,
      description: formatPainPointsCanvas(discovery.pain_points),
      parentId: sk3.id,
      status: 'TODO'
    });
    console.log(`✅ Created ${sk5.identifier}: Pain Points`);

    // Create data model definition (SK-6)
    const sk6 = await createIssue({
      teamId: team.id,
      title: `SK-6: Data Model Definition — ${discovery.client_name}`,
      description: formatDataModelDef(discovery),
      parentId: sk3.id,
      status: 'TODO'
    });
    console.log(`✅ Created ${sk6.identifier}: Data Model`);

    // Create onboarding workflow (SK-8)
    const sk8 = await createIssue({
      teamId: team.id,
      title: `SK-8: Onboarding Workflow — ${discovery.client_name}`,
      description: formatOnboardingWorkflow(discovery),
      parentId: sk3.id,
      status: 'TODO'
    });
    console.log(`✅ Created ${sk8.identifier}: Onboarding Workflow`);

    return {
      sk3: { id: sk3.id, identifier: sk3.identifier },
      sk4: { id: sk4.id, identifier: sk4.identifier },
      sk5: { id: sk5.id, identifier: sk5.identifier },
      sk6: { id: sk6.id, identifier: sk6.identifier },
      sk8: { id: sk8.id, identifier: sk8.identifier }
    };

  } catch (error) {
    console.error('❌ Error populating discovery framework:', error.message);
    throw error;
  }
}

/**
 * Format discovery questionnaire
 */
function formatDiscoveryQuestionnaire(discovery) {
  return `# Discovery Questionnaire — ${discovery.client_name}

## Client Context
- **Initiative:** ${discovery.initiative}
- **Industry/Mission:** ${discovery.team_context?.industry || 'Not specified'}
- **Team Size:** ${discovery.team_context?.team_size || 'Not specified'}
- **Timeline:** ${discovery.team_context?.timeline || 'Not specified'}

## Key Questions

### Current State
- What systems are currently in place?
- What is working well? What isn't?
- What are your biggest operational bottlenecks?

### Pain Points
${discovery.pain_points?.map((p, i) => `${i + 1}. ${p}`).join('\n') || '- (To be filled in)'}

### Technical Environment
- Current tech stack: ${JSON.stringify(discovery.tech_stack?.current || {}, null, 2)}
- Desired tech stack: ${JSON.stringify(discovery.tech_stack?.desired || {}, null, 2)}

### Success Criteria
- What would success look like in 6 months?
- What metrics matter most?
- Who are the key stakeholders?

## Next Steps
- [ ] Schedule discovery call
- [ ] Gather additional context
- [ ] Build tech stack assessment (SK-4)
`;
}

/**
 * Format tech stack matrix
 */
function formatTechStackMatrix(techStack) {
  const current = techStack?.current || {};
  const desired = techStack?.desired || {};

  const allCategories = new Set([...Object.keys(current), ...Object.keys(desired)]);

  let matrix = `# Tech Stack Assessment Matrix

## Current vs. Desired

| Category | Current | Desired | Gap |
|----------|---------|---------|-----|
`;

  for (const cat of allCategories) {
    const curr = current[cat] || '—';
    const des = desired[cat] || '—';
    const gap = (curr === des) ? '✅' : '⚠️';
    matrix += `| ${cat} | ${curr} | ${des} | ${gap} |\n`;
  }

  matrix += `

## Assessment Notes
- Identify compliance requirements (HIPAA, GDPR, etc.)
- Evaluate migration strategy
- Document integration points
- Plan for testing and rollout

## Recommendation
(To be filled in after discovery call)
`;

  return matrix;
}

/**
 * Format pain points canvas
 */
function formatPainPointsCanvas(painPoints) {
  return `# Pain Points & Opportunities Canvas

## Identified Pain Points
${painPoints?.map((p, i) => `${i + 1}. **${p}**
   - Impact: (to be assessed)
   - Frequency: (to be assessed)
   - Cost: (to be assessed)
`).join('\n') || '(To be filled in during discovery)'}

## Opportunity Mapping

For each pain point, identify:
- **Root cause:** What's really driving this?
- **Current workaround:** How do they live with it today?
- **Ideal solution:** What would solve this?
- **Expected ROI:** Time saved? Cost reduction? Revenue impact?

## Priority Matrix

| Pain Point | Impact | Effort | Priority |
|------------|--------|--------|----------|
| | High/Med/Low | High/Med/Low | 1/2/3 |

## Implementation Sequencing
- Phase 1: Quick wins (low effort, high impact)
- Phase 2: Medium priority items
- Phase 3: Strategic long-term capabilities

## Success Metrics
(To be defined based on prioritized pain points)
`;
}

/**
 * Format data model definition
 */
function formatDataModelDef(discovery) {
  return `# Data Model Definition

## Entities & Relationships

Based on discovery, the following entities are likely needed:

### Primary Entities
(To be designed after discovery; see SK-6 in Data Model Agent)

### Key Relationships
(To be mapped in normalization phase)

## Normalization Target
- 3NF (Third Normal Form) for relational model
- Document-style for NoSQL (if applicable)

## Migration Strategy
- How to import historical data?
- Data validation rules?
- Audit trail requirements?

## Access Control
- Who needs to see what data?
- HIPAA/privacy considerations?
- Role-based access control (RBAC) needed?

## Scalability Notes
- Expected data volume?
- Query patterns?
- Archive/retention policy?

## Next Phase
→ See SK-6 (Data Model Agent) for detailed schema design and SQL generation
`;
}

/**
 * Format onboarding workflow
 */
function formatOnboardingWorkflow(discovery) {
  return `# Onboarding Workflow — ${discovery.client_name}

## 6-Week Engagement Plan

### Week 1-2: Discovery & Scoping
- [ ] Complete discovery questionnaire (SK-3)
- [ ] Technical assessment (SK-4)
- [ ] Data model kickoff (SK-6)
- **Deliverable:** Proposal & SOW

### Week 3-4: Build & Integration
- [ ] Data migration planning
- [ ] Integration architecture
- [ ] Compliance audit (if needed)
- **Deliverable:** Tech design document

### Week 5-6: Pilot & Handoff
- [ ] Pilot environment setup
- [ ] Team training
- [ ] Production deployment readiness
- **Deliverable:** Operations runbook

## Decision Gates
- End of Week 2: Board/stakeholder approval to proceed
- End of Week 4: Technical design sign-off
- End of Week 6: Production readiness review

## Success Criteria
- (To be defined based on SK-3 through SK-6)

## Resource Allocation
- Josh: 1/4 time (discovery + key decisions)
- Omega: Full execution (design + implementation)
- Client team: TBD hours/week

## Risk Mitigation
- Compliance review on Week 4
- Data backup strategy before migration
- Rollback plan documented

## Next Phase
→ See Onboarding Playbook Agent for detailed phase breakdown and resource planning
`;
}

/**
 * CLI Interface
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(`Usage:
  node batch-populate-discovery.js <client_name> <initiative_key> [discovery.json]

Example:
  node batch-populate-discovery.js "New Client" CG /path/to/discovery.json
  node batch-populate-discovery.js "Seattle Unity" CG --template

Options:
  --template    Create sample discovery object for editing
  --json        Read full discovery JSON from stdin or file
`);
    process.exit(1);
  }

  const [clientName, initiativeKey, jsonFile] = args;

  // Load or create discovery object
  let discovery = {
    client_name: clientName,
    initiative: initiativeKey,
    tech_stack: { current: {}, desired: {} },
    pain_points: [],
    team_context: { industry: '', team_size: '', timeline: '' }
  };

  if (jsonFile && jsonFile !== '--template') {
    try {
      const fs = require('fs');
      const data = fs.readFileSync(jsonFile, 'utf-8');
      discovery = { ...discovery, ...JSON.parse(data) };
    } catch (err) {
      console.error('Error reading JSON file:', err.message);
      process.exit(1);
    }
  }

  try {
    const result = await populateDiscoveryFramework(discovery);
    console.log('\n✅ Discovery framework populated successfully!');
    console.log('\n📌 Created Issues:');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Fatal error:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  populateDiscoveryFramework,
  formatDiscoveryQuestionnaire,
  formatTechStackMatrix,
  formatPainPointsCanvas,
  formatDataModelDef,
  formatOnboardingWorkflow
};
