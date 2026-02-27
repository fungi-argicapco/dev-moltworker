/**
 * Linear GraphQL API Wrapper
 * Handles all Linear CRUD operations for stream-kinetics workspace
 */

const https = require('https');

const API_TOKEN = process.env.LINEAR_API_TOKEN;
if (!API_TOKEN) throw new Error('LINEAR_API_TOKEN environment variable is required');

/**
 * Execute GraphQL query/mutation
 */
function query(gql) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ query: gql });
    const options = {
      hostname: 'api.linear.app',
      path: '/graphql',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
        'Authorization': API_TOKEN
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`JSON parse error: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

/**
 * Create issue
 */
async function createIssue(input) {
  const { teamId, title, description, parentId, assigneeId, status } = input;

  let mutation = `mutation {
    issueCreate(input: {
      teamId: "${teamId}"
      title: "${escapeQuotes(title)}"
      ${description ? `description: "${escapeQuotes(description)}"` : ''}
      ${parentId ? `parentId: "${parentId}"` : ''}
      ${assigneeId ? `assigneeId: "${assigneeId}"` : ''}
    }) {
      issue { id identifier title }
    }
  }`;

  const res = await query(mutation);
  if (res.errors) throw new Error(JSON.stringify(res.errors));
  return res.data.issueCreate.issue;
}

/**
 * Update issue
 */
async function updateIssue(issueId, input) {
  const { description, status, assigneeId } = input;

  let mutation = `mutation {
    issueUpdate(id: "${issueId}", input: {
      ${description ? `description: "${escapeQuotes(description)}"` : ''}
      ${status ? `stateId: "${status}"` : ''}
      ${assigneeId ? `assigneeId: "${assigneeId}"` : ''}
    }) {
      issue { id identifier }
    }
  }`;

  const res = await query(mutation);
  if (res.errors) throw new Error(JSON.stringify(res.errors));
  return res.data.issueUpdate.issue;
}

/**
 * Get team ID by key
 */
async function getTeamByKey(key) {
  const res = await query(`{ teams(first: 50) { nodes { id name key } } }`);
  if (res.errors) throw new Error(JSON.stringify(res.errors));
  return res.data.teams.nodes.find(t => t.key === key);
}

/**
 * Escape quotes for GraphQL
 */
function escapeQuotes(str) {
  return str.replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

module.exports = {
  query,
  createIssue,
  updateIssue,
  getTeamByKey,
  API_TOKEN
};
