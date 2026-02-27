#!/usr/bin/env node

/**
 * Data Model Agent — Schema Designer
 * Create entity models from discovery data
 */

const fs = require('fs');

/**
 * Design entity model from discovery data
 * @param {Object} discovery - Discovery object (from extract-patterns)
 * @returns {Object} Entity schema definition
 */
function designEntityModel(discovery) {
  const schema = {
    designed_at: new Date().toISOString(),
    client_name: discovery.client_name,
    initiative: discovery.initiative,
    entities: {},
    relationships: [],
    constraints: [],
    indexes: []
  };

  // Analyze discovery to identify core entities
  const identifiedEntities = analyzeDiscoveryForEntities(discovery);
  
  // Create entity definitions
  for (const entityName of identifiedEntities) {
    schema.entities[entityName] = {
      name: entityName,
      fields: generateFieldsForEntity(entityName, discovery),
      description: generateEntityDescription(entityName, discovery),
      examples: generateExamples(entityName)
    };
  }

  // Identify relationships
  schema.relationships = identifyRelationships(identifiedEntities, discovery);
  
  // Add constraints
  schema.constraints = defineConstraints(schema.entities);
  
  // Add indexes for performance
  schema.indexes = defineIndexes(schema.entities);

  return schema;
}

/**
 * Analyze discovery to identify core entities
 */
function analyzeDiscoveryForEntities(discovery) {
  const entities = new Set();

  // Entity detection heuristics
  const keywords = {
    'Customer': ['client', 'customer', 'user', 'account', 'organization', 'company'],
    'Contact': ['contact', 'person', 'staff', 'team member', 'employee', 'user'],
    'Interaction': ['call', 'email', 'meeting', 'interaction', 'engagement', 'touch'],
    'Opportunity': ['opportunity', 'deal', 'proposal', 'project', 'initiative', 'engagement'],
    'Product': ['product', 'service', 'offering', 'solution', 'feature', 'module'],
    'Feature': ['feature', 'capability', 'function', 'module', 'tool', 'functionality'],
    'Order': ['order', 'purchase', 'subscription', 'transaction', 'billing'],
    'Invoice': ['invoice', 'bill', 'receipt', 'payment', 'charge'],
    'Document': ['document', 'file', 'report', 'proposal', 'contract'],
    'Task': ['task', 'action item', 'todo', 'milestone', 'deliverable'],
    'Event': ['event', 'calendar', 'schedule', 'appointment', 'meeting']
  };

  // Scan pain points and opportunities for entity keywords
  const allText = [
    ...(discovery.pain_points || []),
    ...(discovery.opportunities || []),
    JSON.stringify(discovery.tech_stack || {}),
    JSON.stringify(discovery.team_context || {})
  ].join(' ').toLowerCase();

  for (const [entity, keywords_list] of Object.entries(keywords)) {
    for (const keyword of keywords_list) {
      if (allText.includes(keyword)) {
        entities.add(entity);
        break;
      }
    }
  }

  // Always include core entities
  entities.add('Customer');
  entities.add('Opportunity');
  entities.add('Interaction');

  return Array.from(entities).sort();
}

/**
 * Generate fields for entity
 */
function generateFieldsForEntity(entityName, discovery) {
  const commonFields = {
    id: { type: 'uuid', required: true, description: 'Primary key' },
    created_at: { type: 'timestamp', required: true, description: 'Creation timestamp' },
    updated_at: { type: 'timestamp', required: true, description: 'Last update timestamp' },
    created_by: { type: 'uuid', required: false, description: 'Creator user ID' },
    archived: { type: 'boolean', required: false, default: false, description: 'Soft delete flag' }
  };

  const entityFields = {
    'Customer': {
      name: { type: 'string', required: true, length: 255 },
      email: { type: 'string', required: false, length: 255 },
      phone: { type: 'string', required: false, length: 20 },
      website: { type: 'string', required: false, length: 255 },
      industry: { type: 'string', required: false, length: 100 },
      status: { type: 'enum', required: true, values: ['prospect', 'active', 'paused', 'churned'] },
      initiative: { type: 'string', required: false, length: 100 },
      lifetime_value: { type: 'decimal', precision: '12,2', required: false }
    },
    'Contact': {
      first_name: { type: 'string', required: true, length: 100 },
      last_name: { type: 'string', required: true, length: 100 },
      email: { type: 'string', required: false, length: 255 },
      phone: { type: 'string', required: false, length: 20 },
      title: { type: 'string', required: false, length: 100 },
      department: { type: 'string', required: false, length: 100 },
      customer_id: { type: 'uuid', required: true, description: 'Foreign key to Customer' },
      is_decision_maker: { type: 'boolean', required: false, default: false }
    },
    'Opportunity': {
      title: { type: 'string', required: true, length: 255 },
      description: { type: 'text', required: false },
      value: { type: 'decimal', precision: '12,2', required: false },
      probability: { type: 'integer', required: false, min: 0, max: 100 },
      stage: { type: 'enum', required: true, values: ['discovery', 'proposal', 'negotiation', 'closed_won', 'closed_lost'] },
      customer_id: { type: 'uuid', required: true, description: 'Foreign key to Customer' },
      contact_id: { type: 'uuid', required: false, description: 'Foreign key to Contact' },
      expected_close: { type: 'date', required: false }
    },
    'Interaction': {
      type: { type: 'enum', required: true, values: ['call', 'email', 'meeting', 'note', 'task'] },
      subject: { type: 'string', required: true, length: 255 },
      description: { type: 'text', required: false },
      duration_minutes: { type: 'integer', required: false },
      customer_id: { type: 'uuid', required: true, description: 'Foreign key to Customer' },
      contact_id: { type: 'uuid', required: false, description: 'Foreign key to Contact' },
      interaction_date: { type: 'timestamp', required: true },
      outcome: { type: 'string', required: false, length: 255 }
    },
    'Feature': {
      name: { type: 'string', required: true, length: 255 },
      description: { type: 'text', required: false },
      category: { type: 'string', required: false, length: 100 },
      status: { type: 'enum', required: false, values: ['backlog', 'in_development', 'beta', 'released', 'deprecated'] }
    },
    'FeatureAdoption': {
      customer_id: { type: 'uuid', required: true, description: 'Foreign key to Customer' },
      feature_id: { type: 'uuid', required: true, description: 'Foreign key to Feature' },
      adoption_date: { type: 'date', required: false },
      status: { type: 'enum', required: true, values: ['pilot', 'active', 'paused', 'abandoned'] },
      usage_score: { type: 'integer', required: false, min: 0, max: 100 }
    }
  };

  return {
    ...commonFields,
    ...(entityFields[entityName] || {})
  };
}

/**
 * Generate description for entity
 */
function generateEntityDescription(entityName, discovery) {
  const descriptions = {
    'Customer': 'Core customer/client account',
    'Contact': 'Individual person at customer organization',
    'Opportunity': 'Business opportunity or deal',
    'Interaction': 'Communication touchpoint (call, email, meeting)',
    'Feature': 'Product capability or offering',
    'FeatureAdoption': 'Tracking of feature adoption per customer',
    'Task': 'Action item or deliverable',
    'Document': 'Stored document or artifact'
  };

  return descriptions[entityName] || `${entityName} entity`;
}

/**
 * Generate example records for entity
 */
function generateExamples(entityName) {
  const examples = {
    'Customer': [
      {
        id: '550e8400-e29b-41d4-a716-446655440000',
        name: 'Acme Corp',
        email: 'contact@acmecorp.com',
        industry: 'Technology',
        status: 'active',
        created_at: '2025-01-15T10:30:00Z'
      }
    ],
    'Contact': [
      {
        id: '550e8400-e29b-41d4-a716-446655440001',
        first_name: 'Jane',
        last_name: 'Smith',
        email: 'jane@acmecorp.com',
        title: 'VP Engineering',
        customer_id: '550e8400-e29b-41d4-a716-446655440000',
        is_decision_maker: true
      }
    ],
    'Opportunity': [
      {
        id: '550e8400-e29b-41d4-a716-446655440002',
        title: 'Platform Implementation',
        value: 50000,
        stage: 'proposal',
        customer_id: '550e8400-e29b-41d4-a716-446655440000',
        expected_close: '2025-03-15'
      }
    ]
  };

  return examples[entityName] || [];
}

/**
 * Identify relationships between entities
 */
function identifyRelationships(entities, discovery) {
  const relationships = [];

  // Common relationship patterns
  const patterns = [
    { from: 'Customer', to: 'Contact', type: 'one_to_many', description: 'Customer has many Contacts' },
    { from: 'Customer', to: 'Opportunity', type: 'one_to_many', description: 'Customer has many Opportunities' },
    { from: 'Customer', to: 'Interaction', type: 'one_to_many', description: 'Customer has many Interactions' },
    { from: 'Contact', to: 'Opportunity', type: 'one_to_many', description: 'Contact may own Opportunities' },
    { from: 'Contact', to: 'Interaction', type: 'one_to_many', description: 'Contact participates in Interactions' },
    { from: 'Customer', to: 'Feature', type: 'many_to_many', via: 'FeatureAdoption', description: 'Customer adopts Features' },
    { from: 'Opportunity', to: 'Task', type: 'one_to_many', description: 'Opportunity has many Tasks' }
  ];

  // Filter to entities that exist
  for (const pattern of patterns) {
    if (entities.includes(pattern.from) && entities.includes(pattern.to)) {
      relationships.push({
        from: pattern.from,
        to: pattern.to,
        type: pattern.type,
        via: pattern.via || null,
        description: pattern.description,
        foreign_key: `${pattern.to.toLowerCase()}_id`,
        cardinality: pattern.type
      });
    }
  }

  return relationships;
}

/**
 * Define constraints
 */
function defineConstraints(entities) {
  const constraints = [];

  // Unique constraints
  constraints.push({
    type: 'unique',
    entity: 'Customer',
    fields: ['email'],
    description: 'No duplicate customer emails'
  });

  constraints.push({
    type: 'unique',
    entity: 'Contact',
    fields: ['email', 'customer_id'],
    description: 'No duplicate contacts per customer'
  });

  constraints.push({
    type: 'check',
    entity: 'Opportunity',
    condition: 'probability >= 0 AND probability <= 100',
    description: 'Probability must be 0-100'
  });

  constraints.push({
    type: 'check',
    entity: 'Opportunity',
    condition: 'value > 0',
    description: 'Opportunity value must be positive'
  });

  // Foreign key constraints
  constraints.push({
    type: 'foreign_key',
    entity: 'Contact',
    field: 'customer_id',
    references: 'Customer(id)',
    on_delete: 'CASCADE'
  });

  constraints.push({
    type: 'foreign_key',
    entity: 'Opportunity',
    field: 'customer_id',
    references: 'Customer(id)',
    on_delete: 'CASCADE'
  });

  return constraints;
}

/**
 * Define performance indexes
 */
function defineIndexes(entities) {
  const indexes = [];

  // Single-field indexes for common queries
  indexes.push({
    entity: 'Customer',
    fields: ['status'],
    description: 'Query active customers'
  });

  indexes.push({
    entity: 'Customer',
    fields: ['initiative'],
    description: 'Query customers by initiative'
  });

  indexes.push({
    entity: 'Opportunity',
    fields: ['customer_id', 'stage'],
    description: 'Query opportunities by customer and stage'
  });

  indexes.push({
    entity: 'Opportunity',
    fields: ['expected_close'],
    description: 'Query opportunities by close date'
  });

  indexes.push({
    entity: 'Interaction',
    fields: ['customer_id', 'interaction_date'],
    description: 'Query interactions by customer and date'
  });

  indexes.push({
    entity: 'Contact',
    fields: ['customer_id', 'is_decision_maker'],
    description: 'Query decision makers by customer'
  });

  return indexes;
}

/**
 * CLI Interface
 */
async function main() {
  const [jsonFile] = process.argv.slice(2);

  if (!jsonFile) {
    console.log(`Usage:
  node design-schema.js <discovery-json>

Input:
  Discovery JSON object (from extract-patterns.js)

Output:
  Entity schema definition (JSON)

Example:
  node extract-patterns.js client-call.txt | node design-schema.js /dev/stdin
`);
    process.exit(1);
  }

  try {
    let discovery;
    
    if (jsonFile === '/dev/stdin') {
      // Read from stdin
      const stdin = await new Promise((resolve, reject) => {
        let data = '';
        process.stdin.on('data', chunk => data += chunk);
        process.stdin.on('end', () => resolve(data));
        process.stdin.on('error', reject);
      });
      discovery = JSON.parse(stdin);
    } else {
      // Read from file
      const data = fs.readFileSync(jsonFile, 'utf-8');
      discovery = JSON.parse(data);
    }

    console.error(`🎨 Designing entity model for ${discovery.client_name}...\n`);
    
    const schema = designEntityModel(discovery);
    
    console.log(JSON.stringify(schema, null, 2));
    
    console.error(`\n✅ Schema design complete!`);
    console.error(`  Entities: ${Object.keys(schema.entities).length}`);
    console.error(`  Relationships: ${schema.relationships.length}`);
    console.error(`  Constraints: ${schema.constraints.length}`);
    console.error(`  Indexes: ${schema.indexes.length}\n`);

  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  designEntityModel,
  analyzeDiscoveryForEntities,
  generateFieldsForEntity,
  identifyRelationships
};
