#!/usr/bin/env node

/**
 * Customer Analysis Agent
 * Extract customers, engagement metrics, and cross-sell opportunities from D1
 */

const { queryD1, listTables, getTableSchema } = require('./d1-query');

/**
 * List all customers/clients
 * @param {string} database - D1 database name
 * @param {string} initiative - Filter by initiative (optional)
 * @returns {Promise<Array>} Customers list
 */
async function listCustomers(database, initiative = null) {
  let sql = 'SELECT id, name, initiative, created_at, status FROM customers';
  if (initiative) {
    sql += ` WHERE initiative = '${initiative}'`;
  }
  sql += ' ORDER BY created_at DESC';
  
  try {
    return await queryD1(database, sql);
  } catch (error) {
    console.error(`Error listing customers from ${database}:`, error.message);
    return [];
  }
}

/**
 * Get customer engagement metrics
 * @param {string} database - D1 database name
 * @param {string} customerId - Customer ID
 * @returns {Promise<Object>} Engagement metrics
 */
async function getCustomerEngagement(database, customerId) {
  try {
    // Get customer details
    const customerSQL = `SELECT * FROM customers WHERE id = '${customerId}' LIMIT 1`;
    const customers = await queryD1(database, customerSQL);
    if (customers.length === 0) {
      throw new Error(`Customer ${customerId} not found`);
    }
    const customer = customers[0];

    // Get engagement metrics (interactions, last contact, etc.)
    const engagementSQL = `
      SELECT 
        COUNT(*) as total_interactions,
        MAX(interaction_date) as last_contact,
        COUNT(DISTINCT interaction_type) as interaction_types
      FROM interactions
      WHERE customer_id = '${customerId}'
    `;
    const engagement = await queryD1(database, engagementSQL);

    // Get open opportunities
    const opportunitiesSQL = `
      SELECT id, title, value, stage, created_at FROM opportunities
      WHERE customer_id = '${customerId}' AND stage NOT IN ('closed_lost', 'closed_won')
      ORDER BY value DESC
    `;
    const opportunities = await queryD1(database, opportunitiesSQL);

    // Get implementation status
    const implementationSQL = `
      SELECT 
        COUNT(*) as total_features,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active_features,
        COUNT(CASE WHEN status = 'pilot' THEN 1 END) as pilot_features
      FROM feature_adoption
      WHERE customer_id = '${customerId}'
    `;
    const implementation = await queryD1(database, implementationSQL);

    return {
      customer,
      engagement: engagement[0] || {},
      opportunities,
      implementation: implementation[0] || {}
    };
  } catch (error) {
    console.error(`Error getting engagement for ${customerId}:`, error.message);
    return null;
  }
}

/**
 * Identify upsell candidates
 * Customers with feature X but not Y = upsell opportunity
 * @param {string} database - D1 database name
 * @returns {Promise<Array>} Upsell candidates
 */
async function findUpsellCandidates(database) {
  const sql = `
    SELECT 
      c.id,
      c.name,
      c.initiative,
      COUNT(DISTINCT fa1.feature_id) as active_features,
      GROUP_CONCAT(DISTINCT f.category) as feature_categories,
      MAX(i.interaction_date) as last_engagement
    FROM customers c
    LEFT JOIN feature_adoption fa1 ON c.id = fa1.customer_id AND fa1.status = 'active'
    LEFT JOIN features f ON fa1.feature_id = f.id
    LEFT JOIN interactions i ON c.id = i.customer_id
    WHERE c.status = 'active'
    GROUP BY c.id, c.name, c.initiative
    HAVING active_features > 0 AND active_features < 5
    ORDER BY active_features ASC, last_engagement DESC
  `;

  try {
    return await queryD1(database, sql);
  } catch (error) {
    console.error('Error finding upsell candidates:', error.message);
    return [];
  }
}

/**
 * Identify cross-initiative opportunities
 * Find high-value customers in one initiative who might benefit from another
 * @param {string} database - D1 database name
 * @returns {Promise<Array>} Cross-sell opportunities
 */
async function findCrossSellOpportunities(database) {
  const sql = `
    SELECT 
      c.id,
      c.name,
      c.initiative,
      c.industry,
      SUM(o.value) as total_opportunity_value,
      COUNT(DISTINCT fa.feature_id) as features_adopted,
      GROUP_CONCAT(DISTINCT o.product_area) as relevant_areas
    FROM customers c
    LEFT JOIN opportunities o ON c.id = o.customer_id AND o.stage IN ('proposal', 'negotiation', 'closed_won')
    LEFT JOIN feature_adoption fa ON c.id = fa.customer_id AND fa.status = 'active'
    WHERE c.status = 'active'
    GROUP BY c.id, c.name, c.initiative, c.industry
    HAVING total_opportunity_value > 0 OR features_adopted >= 3
    ORDER BY total_opportunity_value DESC, features_adopted DESC
  `;

  try {
    return await queryD1(database, sql);
  } catch (error) {
    console.error('Error finding cross-sell opportunities:', error.message);
    return [];
  }
}

/**
 * Get implementation patterns
 * What features are commonly implemented together?
 * @param {string} database - D1 database name
 * @returns {Promise<Array>} Feature clusters
 */
async function getImplementationPatterns(database) {
  const sql = `
    SELECT 
      fa1.feature_id as feature_1,
      fa2.feature_id as feature_2,
      COUNT(*) as co_adoption_count,
      GROUP_CONCAT(DISTINCT c.initiative) as initiatives
    FROM feature_adoption fa1
    JOIN feature_adoption fa2 ON fa1.customer_id = fa2.customer_id 
      AND fa1.feature_id < fa2.feature_id
      AND fa1.status = 'active' AND fa2.status = 'active'
    JOIN customers c ON fa1.customer_id = c.id
    GROUP BY fa1.feature_id, fa2.feature_id
    HAVING co_adoption_count >= 2
    ORDER BY co_adoption_count DESC
  `;

  try {
    return await queryD1(database, sql);
  } catch (error) {
    console.error('Error getting implementation patterns:', error.message);
    return [];
  }
}

/**
 * Calculate customer health score
 * Based on engagement, feature adoption, and opportunity pipeline
 * @param {string} database - D1 database name
 * @param {string} customerId - Customer ID
 * @returns {Promise<Object>} Health score breakdown
 */
async function getCustomerHealthScore(database, customerId) {
  try {
    const engagement = await getCustomerEngagement(database, customerId);
    if (!engagement) return null;

    const customer = engagement.customer;
    const metrics = engagement.engagement;
    const features = engagement.implementation;
    const opps = engagement.opportunities;

    // Calculate component scores (0-100 each)
    let engagementScore = Math.min(100, (metrics.total_interactions || 0) * 10);
    let adoptionScore = Math.min(100, (features.active_features || 0) * 20);
    let opportunityScore = opps.length > 0 ? 75 : 25;

    // Weight and combine
    const healthScore = Math.round(
      (engagementScore * 0.3) +
      (adoptionScore * 0.4) +
      (opportunityScore * 0.3)
    );

    return {
      customer_id: customerId,
      customer_name: customer.name,
      health_score: healthScore,
      engagement_score: Math.round(engagementScore),
      adoption_score: Math.round(adoptionScore),
      opportunity_score: Math.round(opportunityScore),
      last_contact: metrics.last_contact,
      active_features: features.active_features || 0,
      open_opportunities: opps.length,
      risk_level: healthScore >= 75 ? 'low' : healthScore >= 50 ? 'medium' : 'high'
    };
  } catch (error) {
    console.error(`Error calculating health score for ${customerId}:`, error.message);
    return null;
  }
}

/**
 * Generate customer report
 * @param {string} database - D1 database name
 * @returns {Promise<Object>} Report summary
 */
async function generateCustomerReport(database) {
  console.log(`\n📊 Generating Customer Report for ${database}...\n`);

  try {
    const customers = await listCustomers(database);
    const upsellCandidates = await findUpsellCandidates(database);
    const crossSellOps = await findCrossSellOpportunities(database);
    const patterns = await getImplementationPatterns(database);

    console.log(`Found ${customers.length} active customers`);
    console.log(`  → ${upsellCandidates.length} upsell candidates`);
    console.log(`  → ${crossSellOps.length} cross-sell opportunities`);
    console.log(`  → ${patterns.length} feature co-adoption patterns\n`);

    // Calculate health scores for all customers
    console.log('📈 Customer Health Scores:\n');
    const healthScores = [];
    for (const customer of customers.slice(0, 10)) {
      const score = await getCustomerHealthScore(database, customer.id);
      if (score) {
        healthScores.push(score);
        const riskIcon = 
          score.risk_level === 'low' ? '✅' :
          score.risk_level === 'medium' ? '⚠️' : '🔴';
        console.log(`${riskIcon} ${score.customer_name} (${score.health_score}/100) — ${score.risk_level} risk`);
      }
    }

    return {
      timestamp: new Date().toISOString(),
      database,
      total_customers: customers.length,
      upsell_candidates: upsellCandidates.length,
      cross_sell_opportunities: crossSellOps.length,
      feature_patterns: patterns.length,
      health_scores: healthScores.slice(0, 5)
    };
  } catch (error) {
    console.error('Error generating report:', error.message);
    throw error;
  }
}

/**
 * CLI Interface
 */
async function main() {
  const [command, database, customerId] = process.argv.slice(2);

  if (!command || !database) {
    console.log(`Usage:
  node customer-analysis.js <command> <database> [customer_id]

Commands:
  list              List all customers
  upsell            Find upsell candidates
  crosssell         Find cross-sell opportunities
  patterns          Get feature co-adoption patterns
  health <id>       Get health score for customer
  report            Generate full customer report

Databases:
  crm-db (production)
  crm-db-staging (development)
  contentguru-db (Seattle Unity, etc.)

Example:
  node customer-analysis.js list crm-db
  node customer-analysis.js upsell crm-db
  node customer-analysis.js health crm-db <customer_id>
  node customer-analysis.js report crm-db
`);
    process.exit(1);
  }

  try {
    switch (command) {
      case 'list':
        const customers = await listCustomers(database);
        console.log(JSON.stringify(customers, null, 2));
        break;

      case 'upsell':
        const upsell = await findUpsellCandidates(database);
        console.log(`\n🎯 Upsell Candidates (${upsell.length} found):\n`);
        console.log(JSON.stringify(upsell, null, 2));
        break;

      case 'crosssell':
        const crosssell = await findCrossSellOpportunities(database);
        console.log(`\n🔄 Cross-Sell Opportunities (${crosssell.length} found):\n`);
        console.log(JSON.stringify(crosssell, null, 2));
        break;

      case 'patterns':
        const patterns = await getImplementationPatterns(database);
        console.log(`\n📈 Feature Co-Adoption Patterns (${patterns.length} found):\n`);
        console.log(JSON.stringify(patterns, null, 2));
        break;

      case 'health':
        if (!customerId) {
          console.error('Error: health command requires customer_id');
          process.exit(1);
        }
        const health = await getCustomerHealthScore(database, customerId);
        console.log('\n💚 Customer Health Score:\n');
        console.log(JSON.stringify(health, null, 2));
        break;

      case 'report':
        const report = await generateCustomerReport(database);
        console.log('\n📋 Report Summary:\n');
        console.log(JSON.stringify(report, null, 2));
        break;

      default:
        console.error(`Unknown command: ${command}`);
        process.exit(1);
    }
  } catch (error) {
    console.error('Fatal error:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  listCustomers,
  getCustomerEngagement,
  findUpsellCandidates,
  findCrossSellOpportunities,
  getImplementationPatterns,
  getCustomerHealthScore,
  generateCustomerReport
};
