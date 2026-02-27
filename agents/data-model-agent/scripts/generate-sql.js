#!/usr/bin/env node

/**
 * Data Model Agent — SQL Generator
 * Generate CREATE TABLE statements from schema definition
 */

const fs = require('fs');

/**
 * Generate SQL from schema
 * @param {Object} schema - Schema object (from design-schema.js)
 * @returns {string} SQL DDL statements
 */
function generateSQL(schema) {
  let sql = '-- Generated SQL for ' + schema.client_name + '\n';
  sql += '-- Created: ' + schema.designed_at + '\n';
  sql += '-- Initiative: ' + (schema.initiative || 'unspecified') + '\n\n';

  sql += '-- ============================================\n';
  sql += '-- ENTITIES\n';
  sql += '-- ============================================\n\n';

  // Generate CREATE TABLE for each entity
  for (const [entityName, entityDef] of Object.entries(schema.entities)) {
    sql += generateCreateTable(entityName, entityDef);
    sql += '\n';
  }

  // Add constraints
  if (schema.relationships && schema.relationships.length > 0) {
    sql += '\n-- ============================================\n';
    sql += '-- FOREIGN KEY CONSTRAINTS\n';
    sql += '-- ============================================\n\n';

    for (const rel of schema.relationships) {
      sql += generateForeignKey(rel);
    }
  }

  // Add indexes
  if (schema.indexes && schema.indexes.length > 0) {
    sql += '\n-- ============================================\n';
    sql += '-- INDEXES\n';
    sql += '-- ============================================\n\n';

    for (const idx of schema.indexes) {
      sql += generateIndex(idx);
    }
  }

  return sql;
}

/**
 * Generate CREATE TABLE statement
 */
function generateCreateTable(entityName, entityDef) {
  const tableName = entityNameToTableName(entityName);
  let createStmt = `CREATE TABLE IF NOT EXISTS ${tableName} (\n`;

  const columnLines = [];

  // Add columns
  for (const [fieldName, fieldDef] of Object.entries(entityDef.fields)) {
    columnLines.push(generateColumn(fieldName, fieldDef));
  }

  // Add primary key
  columnLines.push('  PRIMARY KEY (id)');

  createStmt += columnLines.join(',\n') + '\n';
  createStmt += `);\n\n`;

  // Add comment
  createStmt += `-- ${entityDef.description || 'Entity: ' + entityName}\n`;

  return createStmt;
}

/**
 * Convert entity name to table name
 */
function entityNameToTableName(entityName) {
  return entityName
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/^_/, '')
    .replace(/_+/g, '_');
}

/**
 * Generate column definition
 */
function generateColumn(fieldName, fieldDef) {
  const colName = fieldNameToColumnName(fieldName);
  const colType = mapSQLType(fieldDef.type);
  
  let colDef = `  ${colName} ${colType}`;

  // Add constraints
  if (fieldDef.required) {
    colDef += ' NOT NULL';
  }

  // Handle enums
  if (fieldDef.type === 'enum' && fieldDef.values) {
    const valuesStr = fieldDef.values.map(v => `'${v}'`).join(', ');
    colDef += ` CHECK (${colName} IN (${valuesStr}))`;
  }

  // Handle defaults
  if (fieldDef.default !== undefined) {
    if (typeof fieldDef.default === 'boolean') {
      colDef += ` DEFAULT ${fieldDef.default ? 'true' : 'false'}`;
    } else if (typeof fieldDef.default === 'string') {
      colDef += ` DEFAULT '${fieldDef.default}'`;
    } else {
      colDef += ` DEFAULT ${fieldDef.default}`;
    }
  }

  // Add comment
  if (fieldDef.description) {
    colDef += ` -- ${fieldDef.description}`;
  }

  return colDef;
}

/**
 * Convert field name to column name
 */
function fieldNameToColumnName(fieldName) {
  return fieldName
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/^_/, '')
    .replace(/_+/g, '_');
}

/**
 * Map field type to SQL type
 */
function mapSQLType(fieldType) {
  const typeMap = {
    'uuid': 'TEXT PRIMARY KEY',
    'string': 'TEXT',
    'text': 'TEXT',
    'integer': 'INTEGER',
    'decimal': 'REAL',
    'boolean': 'BOOLEAN',
    'date': 'DATE',
    'timestamp': 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP',
    'enum': 'TEXT'
  };

  return typeMap[fieldType] || 'TEXT';
}

/**
 * Generate foreign key constraint
 */
function generateForeignKey(relationship) {
  const fromTable = entityNameToTableName(relationship.from);
  const toTable = entityNameToTableName(relationship.to);
  const fkName = `${fromTable}_${relationship.foreign_key}`;

  let fk = `ALTER TABLE ${fromTable} ADD CONSTRAINT ${fkName}\n`;
  fk += `  FOREIGN KEY (${relationship.foreign_key}) REFERENCES ${toTable}(id);\n\n`;

  return fk;
}

/**
 * Generate index
 */
function generateIndex(indexDef) {
  const tableName = entityNameToTableName(indexDef.entity);
  const indexName = `idx_${tableName}_${indexDef.fields.join('_')}`;
  const columns = indexDef.fields.map(f => fieldNameToColumnName(f)).join(', ');

  let idx = `CREATE INDEX IF NOT EXISTS ${indexName}\n`;
  idx += `  ON ${tableName} (${columns});\n`;
  idx += `  -- ${indexDef.description}\n\n`;

  return idx;
}

/**
 * CLI Interface
 */
async function main() {
  const [schemaFile] = process.argv.slice(2);

  if (!schemaFile) {
    console.log(`Usage:
  node generate-sql.js <schema-json>

Input:
  Schema definition JSON (from design-schema.js)

Output:
  SQL DDL statements (CREATE TABLE, ALTER TABLE, CREATE INDEX)

Example:
  node design-schema.js discovery.json | node generate-sql.js /dev/stdin > schema.sql
`);
    process.exit(1);
  }

  try {
    let schema;
    
    if (schemaFile === '/dev/stdin') {
      // Read from stdin
      const stdin = await new Promise((resolve, reject) => {
        let data = '';
        process.stdin.on('data', chunk => data += chunk);
        process.stdin.on('end', () => resolve(data));
        process.stdin.on('error', reject);
      });
      schema = JSON.parse(stdin);
    } else {
      // Read from file
      const data = fs.readFileSync(schemaFile, 'utf-8');
      schema = JSON.parse(data);
    }

    console.error(`📝 Generating SQL for ${schema.client_name}...\n`);
    
    const sqlOutput = generateSQL(schema);
    
    console.log(sqlOutput);
    
    console.error(`✅ SQL generation complete!\n`);

  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  generateSQL,
  generateCreateTable,
  entityNameToTableName,
  fieldNameToColumnName,
  mapSQLType
};
