#!/usr/bin/env node

/**
 * Onboarding Playbook Agent — Timeline Creator
 * Generate 6-week engagement timeline and phase breakdown
 */

const fs = require('fs');

/**
 * Create 6-week onboarding timeline
 * @param {Object} discovery - Discovery object
 * @param {Object} options - Timeline options (start_date, budget, etc.)
 * @returns {Object} Timeline definition
 */
function createOnboardingTimeline(discovery, options = {}) {
  const startDate = options.start_date ? new Date(options.start_date) : new Date();
  
  const timeline = {
    generated_at: new Date().toISOString(),
    client_name: discovery.client_name,
    initiative: discovery.initiative,
    start_date: startDate.toISOString().split('T')[0],
    end_date: addWeeks(startDate, 6).toISOString().split('T')[0],
    duration_weeks: 6,
    phases: {},
    milestones: [],
    decision_gates: [],
    resource_allocation: {},
    risk_matrix: []
  };

  // Define 6 weeks
  const weeks = [];
  for (let i = 0; i < 6; i++) {
    const weekStart = addWeeks(startDate, i);
    const weekEnd = addDays(weekStart, 6);
    weeks.push({
      number: i + 1,
      start: weekStart.toISOString().split('T')[0],
      end: weekEnd.toISOString().split('T')[0]
    });
  }

  // Phase 1: Discovery & Scoping (Weeks 1-2)
  timeline.phases['1_discovery'] = {
    name: 'Discovery & Scoping',
    weeks: '1-2',
    duration_days: 14,
    start_date: weeks[0].start,
    end_date: weeks[1].end,
    objectives: [
      'Complete discovery questionnaire',
      'Technical assessment & gap analysis',
      'Identify key stakeholders and decision makers',
      'Define success metrics',
      'Scope data model and integration points'
    ],
    deliverables: [
      'Discovery document (SK-3)',
      'Tech stack assessment (SK-4)',
      'Pain points canvas (SK-5)',
      'Data model outline (SK-6)',
      'Project proposal & SOW',
      'Team onboarding guide'
    ],
    team_effort: {
      josh: '6 hours (discovery calls, key decisions)',
      omega: '20 hours (discovery doc, analysis, SOW)'
    },
    success_criteria: [
      'All discovery questions answered',
      'Stakeholder alignment on scope',
      'Proposal approved by board/leadership'
    ]
  };

  // Phase 2: Build & Integration (Weeks 3-4)
  timeline.phases['2_build'] = {
    name: 'Build & Integration',
    weeks: '3-4',
    duration_days: 14,
    start_date: weeks[2].start,
    end_date: weeks[3].end,
    objectives: [
      'Design system architecture',
      'Plan data migration strategy',
      'Assess compliance requirements (HIPAA, GDPR, etc.)',
      'Design user workflows',
      'Plan integration with existing systems'
    ],
    deliverables: [
      'Technical architecture document',
      'Database schema & SQL',
      'Data migration plan',
      'Integration design document',
      'Compliance audit report (if needed)',
      'Prototype or pilot environment setup'
    ],
    team_effort: {
      josh: '8 hours (architecture reviews, decision gates)',
      omega: '30 hours (design, architecture, documentation)'
    },
    success_criteria: [
      'Technical design approved',
      'Data migration plan validated',
      'Compliance requirements documented'
    ]
  };

  // Phase 3: Pilot & Handoff (Weeks 5-6)
  timeline.phases['3_pilot'] = {
    name: 'Pilot & Handoff',
    weeks: '5-6',
    duration_days: 14,
    start_date: weeks[4].start,
    end_date: weeks[5].end,
    objectives: [
      'Set up pilot environment',
      'Perform data migration (if applicable)',
      'Train client team on system usage',
      'Run smoke tests and acceptance tests',
      'Create operations runbook',
      'Prepare for production deployment'
    ],
    deliverables: [
      'Pilot environment (live)',
      'Migrated data (validated)',
      'Team training materials',
      'Operations runbook',
      'Deployment checklist',
      'Post-launch support plan',
      'Success metrics dashboard'
    ],
    team_effort: {
      josh: '4 hours (final sign-off, handoff)',
      omega: '24 hours (pilot setup, training, handoff)'
    },
    success_criteria: [
      'Pilot environment stable',
      'Team trained and confident',
      'Data migration successful',
      'Ready for production deployment'
    ]
  };

  // Add milestones
  timeline.milestones = [
    {
      date: weeks[0].start,
      phase: 1,
      title: 'Project Kickoff',
      description: 'Formal project start and team introduction'
    },
    {
      date: weeks[1].end,
      phase: 1,
      title: 'Discovery Complete',
      description: 'All discovery inputs gathered; ready for design'
    },
    {
      date: weeks[1].end,
      phase: 1,
      title: 'Board/Leadership Approval',
      description: 'Stakeholder sign-off on proposal and budget'
    },
    {
      date: weeks[3].end,
      phase: 2,
      title: 'Design Review',
      description: 'Technical architecture approved'
    },
    {
      date: weeks[5].end,
      phase: 3,
      title: 'Pilot Complete & Go-Live Ready',
      description: 'Production deployment approved'
    }
  ];

  // Define decision gates
  timeline.decision_gates = [
    {
      week: 2,
      gate: 'Board/Stakeholder Approval',
      required_for: 'Phase 2 budget allocation',
      decision_makers: discovery.decision_makers || ['Leadership'],
      criteria: [
        'Proposal meets budget requirements',
        'Scope is clear and agreed',
        'Timeline is acceptable'
      ]
    },
    {
      week: 4,
      gate: 'Technical Design Sign-Off',
      required_for: 'Moving to pilot phase',
      decision_makers: ['Technical Lead', 'Compliance Officer (if required)'],
      criteria: [
        'Architecture is technically sound',
        'Migration plan is safe',
        'Compliance requirements are met'
      ]
    },
    {
      week: 6,
      gate: 'Production Readiness Review',
      required_for: 'Production deployment',
      decision_makers: ['Client Leadership', 'Project Sponsor'],
      criteria: [
        'Pilot tests passed',
        'Team is trained',
        'Deployment plan is solid',
        'Support plan is in place'
      ]
    }
  ];

  // Resource allocation
  timeline.resource_allocation = {
    total_hours: {
      josh: 18,
      omega: 74,
      total: 92
    },
    hourly_rate: {
      josh: 400,
      omega: 400
    },
    weekly_allocation: {}
  };

  // Calculate weekly allocation
  for (let i = 0; i < 6; i++) {
    timeline.resource_allocation.weekly_allocation[`week_${i + 1}`] = {
      josh_hours: calculateWeeklyEffort(i, 18),
      omega_hours: calculateWeeklyEffort(i, 74),
      estimate_effort: estimateWeeklyBudget(i)
    };
  }

  // Risk matrix
  timeline.risk_matrix = [
    {
      risk: 'Scope creep',
      probability: 'Medium',
      impact: 'High',
      mitigation: 'Weekly scope review meetings; formal change control process'
    },
    {
      risk: 'Data migration issues',
      probability: 'Medium',
      impact: 'High',
      mitigation: 'Detailed migration plan; test migration; rollback procedure'
    },
    {
      risk: 'Team availability',
      probability: 'Low',
      impact: 'Medium',
      mitigation: 'Schedule training early; document procedures; provide run-on support'
    },
    {
      risk: 'Compliance/security blockers',
      probability: 'Medium',
      impact: 'High',
      mitigation: 'Early compliance audit; engage security team; plan for remediation'
    },
    {
      risk: 'Technical complexity',
      probability: 'Medium',
      impact: 'Medium',
      mitigation: 'Prototype early; involve tech leads; plan for extended phases if needed'
    }
  ];

  return timeline;
}

/**
 * Helper: Add weeks to date
 */
function addWeeks(date, weeks) {
  const result = new Date(date);
  result.setDate(result.getDate() + weeks * 7);
  return result;
}

/**
 * Helper: Add days to date
 */
function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Helper: Calculate weekly effort distribution
 */
function calculateWeeklyEffort(weekNumber, totalHours) {
  const distribution = [0.10, 0.20, 0.35, 0.20, 0.10, 0.05]; // Weeks 1-6
  return Math.round(totalHours * distribution[weekNumber] * 10) / 10;
}

/**
 * Helper: Estimate weekly budget
 */
function estimateWeeklyBudget(weekNumber) {
  const joshRate = 400;
  const omegaRate = 400;
  
  const joshHours = calculateWeeklyEffort(weekNumber, 18);
  const omegaHours = calculateWeeklyEffort(weekNumber, 74);
  
  const joshCost = joshHours * joshRate;
  const omegaCost = omegaHours * omegaRate;
  
  return {
    josh: joshCost,
    omega: omegaCost,
    total: joshCost + omegaCost
  };
}

/**
 * CLI Interface
 */
async function main() {
  const [discoveryFile, startDate] = process.argv.slice(2);

  if (!discoveryFile) {
    console.log(`Usage:
  node create-timeline.js <discovery-json> [start-date]

Input:
  Discovery JSON object
  Optional: Start date (YYYY-MM-DD; defaults to today)

Output:
  6-week onboarding timeline (JSON)

Example:
  node create-timeline.js discovery.json
  node create-timeline.js discovery.json 2025-03-01
`);
    process.exit(1);
  }

  try {
    let discovery;
    
    if (discoveryFile === '/dev/stdin') {
      const stdin = await new Promise((resolve, reject) => {
        let data = '';
        process.stdin.on('data', chunk => data += chunk);
        process.stdin.on('end', () => resolve(data));
        process.stdin.on('error', reject);
      });
      discovery = JSON.parse(stdin);
    } else {
      const data = fs.readFileSync(discoveryFile, 'utf-8');
      discovery = JSON.parse(data);
    }

    console.error(`📅 Creating 6-week timeline for ${discovery.client_name}...\n`);
    
    const options = startDate ? { start_date: startDate } : {};
    const timeline = createOnboardingTimeline(discovery, options);
    
    console.log(JSON.stringify(timeline, null, 2));
    
    console.error(`\n✅ Timeline created!`);
    console.error(`  Duration: 6 weeks (${timeline.start_date} to ${timeline.end_date})`);
    console.error(`  Total effort: 92 hours (18 Josh + 74 Omega)`);
    console.error(`  Decision gates: ${timeline.decision_gates.length}\n`);

  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  createOnboardingTimeline,
  addWeeks,
  addDays,
  calculateWeeklyEffort
};
