#!/usr/bin/env node

/**
 * Integration Architect — Tech Stack Assessment
 * Evaluate current vs. desired technology stacks
 */

const fs = require('fs');

/**
 * Assess technology stack
 * @param {Object} discovery - Discovery object with tech_stack
 * @returns {Object} Assessment report
 */
function assessTechStack(discovery) {
  const assessment = {
    assessed_at: new Date().toISOString(),
    client_name: discovery.client_name,
    initiative: discovery.initiative,
    current_stack: discovery.tech_stack?.current || {},
    desired_stack: discovery.tech_stack?.desired || {},
    gaps: [],
    opportunities: [],
    risks: [],
    recommendations: [],
    migration_path: null,
    cost_analysis: {}
  };

  // Identify gaps
  assessment.gaps = identifyGaps(assessment.current_stack, assessment.desired_stack);

  // Identify opportunities
  assessment.opportunities = identifyOpportunities(assessment.current_stack, assessment.desired_stack);

  // Assess risks
  assessment.risks = assessMigrationRisks(assessment.current_stack, assessment.desired_stack);

  // Generate recommendations
  assessment.recommendations = generateRecommendations(assessment);

  // Build migration path
  assessment.migration_path = buildMigrationPath(assessment);

  // Cost analysis
  assessment.cost_analysis = analyzeCost(assessment);

  return assessment;
}

/**
 * Identify gaps between current and desired stacks
 */
function identifyGaps(currentStack, desiredStack) {
  const gaps = [];
  const categories = new Set([...Object.keys(currentStack), ...Object.keys(desiredStack)]);

  for (const category of categories) {
    const current = currentStack[category];
    const desired = desiredStack[category];

    if (!current && desired) {
      gaps.push({
        category,
        gap_type: 'missing',
        current: null,
        desired,
        priority: 'high',
        description: `No current solution for ${category}; need to implement ${desired}`
      });
    } else if (current && desired && current !== desired) {
      gaps.push({
        category,
        gap_type: 'upgrade',
        current,
        desired,
        priority: 'medium',
        description: `Upgrade from ${current} to ${desired} in ${category}`
      });
    } else if (current && !desired) {
      gaps.push({
        category,
        gap_type: 'deprecation',
        current,
        desired: null,
        priority: 'low',
        description: `Current ${current} may be deprecated; consider replacement`
      });
    }
  }

  return gaps.sort((a, b) => {
    const priorityMap = { high: 1, medium: 2, low: 3 };
    return priorityMap[a.priority] - priorityMap[b.priority];
  });
}

/**
 * Identify opportunities for improvement
 */
function identifyOpportunities(currentStack, desiredStack) {
  const opportunities = [];

  // Cost optimization
  const costOptimizations = {
    'Cloudflare': { reason: 'Lower cost than AWS/GCP for many workloads', savings: '30-50%' },
    'D1': { reason: 'Sqlite at global scale; significantly cheaper than traditional databases', savings: '60-70%' },
    'Postgres': { reason: 'Open-source; lower licensing than proprietary databases', savings: '40-60%' },
    'React': { reason: 'Large ecosystem; lower vendor lock-in risk', savings: '20-30%' },
    'Node.js': { reason: 'Open-source runtime; no licensing fees', savings: '25-40%' }
  };

  for (const [tech, info] of Object.entries(costOptimizations)) {
    if (Object.values(desiredStack).join('').includes(tech)) {
      opportunities.push({
        category: 'cost-optimization',
        technology: tech,
        reason: info.reason,
        estimated_savings: info.savings
      });
    }
  }

  // Performance improvements
  if (desiredStack['Database'] === 'D1' || desiredStack['Database'] === 'Postgres') {
    opportunities.push({
      category: 'performance',
      technology: 'Query optimization',
      reason: 'Structured data model enables faster queries than document stores',
      improvement: '2-10x faster complex queries'
    });
  }

  // Scalability
  if (desiredStack['Cloud'] === 'Cloudflare') {
    opportunities.push({
      category: 'scalability',
      technology: 'Global edge network',
      reason: 'Automatic global distribution without complex DevOps',
      improvement: 'Instant global scale; automatic failover'
    });
  }

  return opportunities;
}

/**
 * Assess migration risks
 */
function assessMigrationRisks(currentStack, desiredStack) {
  const risks = [];

  // Data migration risk
  if (currentStack['Database'] && desiredStack['Database'] && currentStack['Database'] !== desiredStack['Database']) {
    risks.push({
      category: 'data-migration',
      description: `Migrating from ${currentStack['Database']} to ${desiredStack['Database']}`,
      probability: 'medium',
      impact: 'high',
      mitigation: 'Comprehensive data validation; test migration; rollback plan'
    });
  }

  // Compatibility risks
  if (currentStack['Frontend'] && desiredStack['Backend']) {
    const incompatibilities = checkCompatibility(currentStack['Frontend'], desiredStack['Backend']);
    if (incompatibilities.length > 0) {
      risks.push({
        category: 'compatibility',
        description: `Potential compatibility issues: ${incompatibilities.join(', ')}`,
        probability: 'medium',
        impact: 'medium',
        mitigation: 'Integration testing; API versioning; gradual rollout'
      });
    }
  }

  // Vendor lock-in
  if (currentStack['Cloud'] === 'AWS' || currentStack['Cloud'] === 'GCP') {
    if (desiredStack['Cloud'] === 'Cloudflare') {
      risks.push({
        category: 'migration-effort',
        description: 'Major cloud provider migration (AWS/GCP → Cloudflare)',
        probability: 'medium',
        impact: 'high',
        mitigation: 'Containerized architecture; abstraction layers; phased migration'
      });
    }
  }

  // Skills/training risk
  risks.push({
    category: 'team-knowledge',
    description: 'Team may need training on new technologies',
    probability: 'high',
    impact: 'medium',
    mitigation: 'Training plan; documentation; gradual rollout with parallel runs'
  });

  return risks;
}

/**
 * Check compatibility between techs
 */
function checkCompatibility(frontend, backend) {
  const incompatibilities = [];

  // Basic compatibility checks
  const compatMap = {
    'React': ['Node.js', 'Python', 'Go', 'Rust', 'Java'],
    'Vue': ['Node.js', 'Python', 'Go', 'Rust', 'Java'],
    'Angular': ['Node.js', 'Python', 'Go', 'Rust', 'Java'],
    'Svelte': ['Node.js', 'Python', 'Go', 'Rust', 'Java']
  };

  if (compatMap[frontend] && !compatMap[frontend].some(b => backend.includes(b))) {
    incompatibilities.push(`${frontend} with ${backend}`);
  }

  return incompatibilities;
}

/**
 * Generate recommendations
 */
function generateRecommendations(assessment) {
  const recommendations = [];

  // Prioritize high-impact, low-effort changes
  assessment.gaps.forEach((gap, idx) => {
    if (gap.priority === 'high') {
      recommendations.push({
        priority: 'critical',
        recommendation: `Implement ${gap.desired || 'solution'} for ${gap.category}`,
        reasoning: gap.description,
        effort: estimateEffort(gap),
        timeline: estimateTimeline(gap),
        phase: assessmentGapToPhase(gap)
      });
    }
  });

  assessment.opportunities.forEach(opp => {
    recommendations.push({
      priority: 'high',
      recommendation: `Adopt ${opp.technology}`,
      reasoning: opp.reason,
      expected_benefit: opp.estimated_savings || opp.improvement,
      phase: 2
    });
  });

  // Sort by priority and effort
  return recommendations.sort((a, b) => {
    const priorityMap = { critical: 0, high: 1, medium: 2, low: 3 };
    return priorityMap[a.priority] - priorityMap[b.priority];
  });
}

/**
 * Build migration path
 */
function buildMigrationPath(assessment) {
  const path = {
    phases: [],
    total_duration: '4-8 weeks',
    start_date: new Date().toISOString().split('T')[0],
    critical_path: []
  };

  // Phase 1: Preparation
  path.phases.push({
    phase: 1,
    name: 'Preparation & Planning',
    duration: '1-2 weeks',
    tasks: [
      'Detailed requirements gathering',
      'Vendor evaluation (if needed)',
      'Architecture design',
      'Risk mitigation planning',
      'Training plan'
    ]
  });

  // Phase 2: Pilot/POC
  path.phases.push({
    phase: 2,
    name: 'Pilot & Proof of Concept',
    duration: '2-3 weeks',
    tasks: [
      'Set up test environment',
      'Data migration testing',
      'Integration testing',
      'Performance testing',
      'Security validation'
    ]
  });

  // Phase 3: Full Migration
  path.phases.push({
    phase: 3,
    name: 'Production Migration',
    duration: '1-2 weeks',
    tasks: [
      'Final data migration',
      'Cutover execution',
      'Monitoring & verification',
      'Team training',
      'Rollback readiness'
    ]
  });

  // Phase 4: Optimization
  path.phases.push({
    phase: 4,
    name: 'Optimization & Support',
    duration: '1-2 weeks',
    tasks: [
      'Performance tuning',
      'Bug fixes & refinement',
      'Extended team training',
      'Post-launch support'
    ]
  });

  // Identify critical path items
  path.critical_path = [
    'Data validation & migration testing',
    'Integration test pass-off',
    'Security audit completion',
    'Stakeholder approval gates'
  ];

  return path;
}

/**
 * Analyze cost implications
 */
function analyzeCost(assessment) {
  const analysis = {
    current_estimated_annual_cost: 0,
    desired_estimated_annual_cost: 0,
    migration_cost: 0,
    payback_period: null,
    cost_notes: []
  };

  // Rough cost estimation (this would be more detailed in reality)
  const techCosts = {
    'AWS': 2000,
    'GCP': 2000,
    'Cloudflare': 500,
    'PostgreSQL': 500,
    'MongoDB': 1500,
    'Oracle': 5000,
    'Salesforce': 2000,
    'Slack': 500
  };

  // Calculate current costs
  for (const tech of Object.values(assessment.current_stack)) {
    analysis.current_estimated_annual_cost += techCosts[tech] || 0;
  }

  // Calculate desired costs
  for (const tech of Object.values(assessment.desired_stack)) {
    analysis.desired_estimated_annual_cost += techCosts[tech] || 0;
  }

  // Migration cost (rough estimate)
  analysis.migration_cost = assessment.gaps.length * 5000; // $5k per major gap

  // Payback period
  if (analysis.current_estimated_annual_cost > analysis.desired_estimated_annual_cost) {
    const annualSavings = analysis.current_estimated_annual_cost - analysis.desired_estimated_annual_cost;
    analysis.payback_period = `${Math.round(analysis.migration_cost / annualSavings)} months`;
  }

  analysis.cost_notes.push(
    'Estimates are approximate; detailed RFQs recommended',
    'Does not include ongoing support/maintenance labor',
    'Assumes standard deployment; complex integrations may increase costs'
  );

  return analysis;
}

/**
 * Helper functions
 */
function estimateEffort(gap) {
  return gap.gap_type === 'missing' ? '40 hours' : gap.gap_type === 'upgrade' ? '20 hours' : '5 hours';
}

function estimateTimeline(gap) {
  return gap.gap_type === 'missing' ? '2 weeks' : gap.gap_type === 'upgrade' ? '1 week' : '3 days';
}

function assessmentGapToPhase(gap) {
  return gap.priority === 'high' ? 2 : gap.priority === 'medium' ? 3 : 4;
}

/**
 * CLI Interface
 */
async function main() {
  const [discoveryFile] = process.argv.slice(2);

  if (!discoveryFile) {
    console.log(`Usage:
  node assess-tech-stack.js <discovery-json>

Input:
  Discovery JSON object with tech_stack

Output:
  Tech stack assessment report (JSON)

Example:
  node assess-tech-stack.js discovery.json
`);
    process.exit(1);
  }

  try {
    const discovery = JSON.parse(fs.readFileSync(discoveryFile, 'utf-8'));
    
    console.error(`🔍 Assessing technology stack for ${discovery.client_name}...\n`);
    
    const assessment = assessTechStack(discovery);
    
    console.log(JSON.stringify(assessment, null, 2));
    
    console.error(`\n✅ Assessment complete!`);
    console.error(`  Gaps identified: ${assessment.gaps.length}`);
    console.error(`  Opportunities: ${assessment.opportunities.length}`);
    console.error(`  Risks: ${assessment.risks.length}`);
    console.error(`  Recommendations: ${assessment.recommendations.length}\n`);

  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  assessTechStack,
  identifyGaps,
  identifyOpportunities,
  assessMigrationRisks
};
