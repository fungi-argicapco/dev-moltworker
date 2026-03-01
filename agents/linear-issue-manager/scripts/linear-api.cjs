#!/usr/bin/env node

/**
 * Linear GraphQL API — Comprehensive CLI Tool
 * All-in-one Linear management for stream-kinetics workspace.
 *
 * Features adopted from ManuelHettich's ClawHub linear skill:
 *   - Team auto-discovery + caching
 *   - Human-friendly status mapping (todo, progress, review, done)
 *   - Daily standup aggregation
 *   - Priority management
 *   - Full-text search
 *   - Comment management
 *
 * Usage: node linear-api.js <command> [args...]
 * Env:   LINEAR_API_KEY (required)
 */

const https = require('https');
const fs = require('fs');
const crypto = require('crypto');

// ── Config ──────────────────────────────────────────────────
const API_TOKEN = process.env.LINEAR_API_KEY;
if (!API_TOKEN) throw new Error('LINEAR_API_KEY environment variable is required');

const CACHE_DIR = '/tmp';
const CACHE_TTL_MS = 3600_000; // 1 hour

// Priority name → numeric value
const PRIORITIES = { none: 0, urgent: 1, high: 2, medium: 3, low: 4 };
const PRIORITY_NAMES = { 0: 'none', 1: 'urgent', 2: 'high', 3: 'medium', 4: 'low' };

// Human-friendly status → Linear category mapping
const STATUS_MAP = {
  backlog: 'backlog',
  todo: 'unstarted',
  unstarted: 'unstarted',
  progress: 'started',
  started: 'started',
  review: 'started',   // "review" maps to started category
  done: 'completed',
  completed: 'completed',
  cancelled: 'canceled',
  canceled: 'canceled',
};

// ── GraphQL Core ────────────────────────────────────────────

function query(gql, variables = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query: gql, variables });
    const options = {
      hostname: 'api.linear.app',
      path: '/graphql',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Authorization': API_TOKEN,
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.errors) {
            reject(new Error(`GraphQL: ${parsed.errors.map((e) => e.message).join(', ')}`));
          } else {
            resolve(parsed.data);
          }
        } catch (e) {
          reject(new Error(`JSON parse: ${e.message}\nBody: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function escapeGql(str) {
  if (!str) return '';
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

// ── Caching ─────────────────────────────────────────────────

function cacheKey(name) {
  const hash = crypto.createHash('md5').update(API_TOKEN).digest('hex').slice(0, 8);
  return `${CACHE_DIR}/linear-${name}-${hash}.json`;
}

function readCache(name) {
  const path = cacheKey(name);
  try {
    const stat = fs.statSync(path);
    if (Date.now() - stat.mtimeMs > CACHE_TTL_MS) return null;
    return JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function writeCache(name, data) {
  try {
    fs.writeFileSync(cacheKey(name), JSON.stringify(data, null, 2));
  } catch {
    // cache write failure is non-fatal
  }
}

// ── Team Operations ─────────────────────────────────────────

async function getTeams(forceRefresh = false) {
  if (!forceRefresh) {
    const cached = readCache('teams');
    if (cached) return cached;
  }

  const data = await query(`{
    teams(first: 50) {
      nodes { id name key description }
    }
  }`);

  const teams = data.teams.nodes;
  writeCache('teams', teams);
  return teams;
}

async function getTeamByKey(key) {
  const teams = await getTeams();
  return teams.find((t) => t.key.toLowerCase() === key.toLowerCase());
}

// ── Workflow State Resolution ───────────────────────────────

async function getWorkflowStates(teamId) {
  const cacheId = `states-${teamId.slice(0, 8)}`;
  const cached = readCache(cacheId);
  if (cached) return cached;

  const data = await query(`{
    workflowStates(first: 100, filter: { team: { id: { eq: "${teamId}" } } }) {
      nodes { id name type position }
    }
  }`);

  const states = data.workflowStates.nodes;
  writeCache(cacheId, states);
  return states;
}

async function resolveStatusId(teamId, statusName) {
  const category = STATUS_MAP[statusName.toLowerCase()];
  if (!category) throw new Error(`Unknown status: ${statusName}. Use: ${Object.keys(STATUS_MAP).join(', ')}`);

  const states = await getWorkflowStates(teamId);
  // Find the first state matching the category type
  const match = states
    .filter((s) => s.type === category)
    .sort((a, b) => a.position - b.position)[0];

  if (!match) throw new Error(`No workflow state of type "${category}" found for team ${teamId}`);
  return match.id;
}

// ── Issue Operations ────────────────────────────────────────

async function getIssue(identifier) {
  const data = await query(`{
    issue(id: "${identifier}") {
      id identifier title description
      priority priorityLabel
      state { id name type }
      assignee { id name email }
      team { id key name }
      parent { id identifier title }
      children { nodes { id identifier title state { name } } }
      labels { nodes { id name } }
      comments { nodes { body user { name } createdAt } }
      url createdAt updatedAt
    }
  }`);
  return data.issue;
}

async function getIssueByIdentifier(identifier) {
  // identifier is like "SK-123" — use search
  const data = await query(`{
    issueSearch(query: "${escapeGql(identifier)}", first: 1) {
      nodes {
        id identifier title description
        priority priorityLabel
        state { id name type }
        assignee { id name email }
        team { id key name }
        parent { id identifier title }
        url createdAt updatedAt
      }
    }
  }`);
  return data.issueSearch.nodes[0] || null;
}

async function myIssues(filter = {}) {
  const stateFilter = filter.state ? `, state: { type: { in: ${JSON.stringify(filter.state)} } }` : '';
  const data = await query(`{
    viewer {
      assignedIssues(first: 50, filter: {
        state: { type: { nin: ["completed", "canceled"] } }
        ${stateFilter ? stateFilter : ''}
      }, orderBy: updatedAt) {
        nodes {
          identifier title priority priorityLabel
          state { name type }
          team { key }
          updatedAt
        }
      }
    }
  }`);
  return data.viewer.assignedIssues.nodes;
}

async function createIssue(input) {
  const { teamId, title, description, parentId, assigneeId, priority, labelIds } = input;

  const fields = [
    `teamId: "${teamId}"`,
    `title: "${escapeGql(title)}"`,
  ];
  if (description) fields.push(`description: "${escapeGql(description)}"`);
  if (parentId) fields.push(`parentId: "${parentId}"`);
  if (assigneeId) fields.push(`assigneeId: "${assigneeId}"`);
  if (priority !== undefined) fields.push(`priority: ${priority}`);
  if (labelIds) fields.push(`labelIds: ${JSON.stringify(labelIds)}`);

  // Resolve status if provided
  if (input.status) {
    const stateId = await resolveStatusId(teamId, input.status);
    fields.push(`stateId: "${stateId}"`);
  }

  const data = await query(`mutation {
    issueCreate(input: { ${fields.join(', ')} }) {
      issue { id identifier title url }
    }
  }`);
  return data.issueCreate.issue;
}

async function updateIssue(issueId, input) {
  const fields = [];
  if (input.title) fields.push(`title: "${escapeGql(input.title)}"`);
  if (input.description) fields.push(`description: "${escapeGql(input.description)}"`);
  if (input.assigneeId) fields.push(`assigneeId: "${input.assigneeId}"`);
  if (input.priority !== undefined) {
    const p = typeof input.priority === 'string' ? PRIORITIES[input.priority.toLowerCase()] : input.priority;
    if (p === undefined) throw new Error(`Unknown priority: ${input.priority}`);
    fields.push(`priority: ${p}`);
  }
  if (input.stateId) fields.push(`stateId: "${input.stateId}"`);

  if (fields.length === 0) throw new Error('No fields to update');

  const data = await query(`mutation {
    issueUpdate(id: "${issueId}", input: { ${fields.join(', ')} }) {
      issue { id identifier title state { name } }
    }
  }`);
  return data.issueUpdate.issue;
}

async function addComment(issueId, body) {
  const data = await query(`mutation {
    commentCreate(input: { issueId: "${issueId}", body: "${escapeGql(body)}" }) {
      comment { id body user { name } }
    }
  }`);
  return data.commentCreate.comment;
}

async function searchIssues(searchQuery, limit = 20) {
  const data = await query(`{
    issueSearch(query: "${escapeGql(searchQuery)}", first: ${limit}) {
      nodes {
        identifier title priority priorityLabel
        state { name type }
        team { key }
        assignee { name }
        url
      }
    }
  }`);
  return data.issueSearch.nodes;
}

// ── Project Operations ──────────────────────────────────────

async function listProjects() {
  const data = await query(`{
    projects(first: 50, orderBy: updatedAt) {
      nodes {
        id name state
        teams { nodes { key } }
        issues { nodes { id } }
        startDate targetDate
      }
    }
  }`);
  return data.projects.nodes;
}

async function projectIssues(projectName) {
  const data = await query(`{
    projects(first: 50, filter: { name: { containsIgnoreCase: "${escapeGql(projectName)}" } }) {
      nodes {
        name
        issues(first: 100) {
          nodes {
            identifier title priority
            state { name type }
            assignee { name }
          }
        }
      }
    }
  }`);
  return data.projects.nodes;
}

// ── Standup ──────────────────────────────────────────────────

async function standup() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [todo, inProgress, done, urgent] = await Promise.all([
    query(`{
      viewer {
        assignedIssues(first: 50, filter: { state: { type: { in: ["unstarted"] } } }) {
          nodes { identifier title team { key } priority }
        }
      }
    }`),
    query(`{
      viewer {
        assignedIssues(first: 50, filter: { state: { type: { in: ["started"] } } }) {
          nodes { identifier title team { key } priority state { name } }
        }
      }
    }`),
    query(`{
      viewer {
        assignedIssues(first: 20, filter: {
          state: { type: { in: ["completed"] } },
          completedAt: { gte: "${since}" }
        }) {
          nodes { identifier title team { key } }
        }
      }
    }`),
    query(`{
      viewer {
        assignedIssues(first: 10, filter: { priority: { eq: 1 }, state: { type: { nin: ["completed", "canceled"] } } }) {
          nodes { identifier title team { key } state { name } }
        }
      }
    }`),
  ]);

  return {
    todo: todo.viewer.assignedIssues.nodes,
    inProgress: inProgress.viewer.assignedIssues.nodes,
    recentlyDone: done.viewer.assignedIssues.nodes,
    urgent: urgent.viewer.assignedIssues.nodes,
  };
}

// ── Formatting ──────────────────────────────────────────────

function formatIssue(issue) {
  const priority = issue.priorityLabel || PRIORITY_NAMES[issue.priority] || '';
  const team = issue.team?.key || '';
  const state = issue.state?.name || '';
  const assignee = issue.assignee?.name || '';
  return `${issue.identifier} [${team}] ${issue.title} (${state}, ${priority}${assignee ? ', ' + assignee : ''})`;
}

function formatIssueDetail(issue) {
  const lines = [
    `# ${issue.identifier}: ${issue.title}`,
    ``,
    `- **Team:** ${issue.team?.key} (${issue.team?.name})`,
    `- **Status:** ${issue.state?.name} (${issue.state?.type})`,
    `- **Priority:** ${issue.priorityLabel}`,
    `- **Assignee:** ${issue.assignee?.name || 'Unassigned'}`,
    `- **URL:** ${issue.url}`,
    `- **Created:** ${issue.createdAt}`,
    `- **Updated:** ${issue.updatedAt}`,
  ];

  if (issue.parent) {
    lines.push(`- **Parent:** ${issue.parent.identifier}: ${issue.parent.title}`);
  }
  if (issue.children?.nodes?.length) {
    lines.push(`\n## Children`);
    issue.children.nodes.forEach((c) => {
      lines.push(`  - ${c.identifier}: ${c.title} (${c.state?.name})`);
    });
  }
  if (issue.labels?.nodes?.length) {
    lines.push(`- **Labels:** ${issue.labels.nodes.map((l) => l.name).join(', ')}`);
  }
  if (issue.description) {
    lines.push(`\n## Description\n${issue.description}`);
  }
  if (issue.comments?.nodes?.length) {
    lines.push(`\n## Comments`);
    issue.comments.nodes.forEach((c) => {
      lines.push(`**${c.user?.name}** (${c.createdAt}):\n${c.body}\n`);
    });
  }

  return lines.join('\n');
}

function formatStandup(data) {
  const lines = ['# 📋 Daily Standup\n'];

  if (data.urgent.length) {
    lines.push('## 🚨 Urgent');
    data.urgent.forEach((i) => lines.push(`  - ${formatIssue(i)}`));
    lines.push('');
  }

  lines.push('## 🔄 In Progress');
  if (data.inProgress.length) {
    data.inProgress.forEach((i) => lines.push(`  - ${formatIssue(i)}`));
  } else {
    lines.push('  (none)');
  }
  lines.push('');

  lines.push('## 📝 Todo');
  if (data.todo.length) {
    data.todo.forEach((i) => lines.push(`  - ${formatIssue(i)}`));
  } else {
    lines.push('  (none)');
  }
  lines.push('');

  lines.push('## ✅ Done (last 24h)');
  if (data.recentlyDone.length) {
    data.recentlyDone.forEach((i) => lines.push(`  - ${formatIssue(i)}`));
  } else {
    lines.push('  (none)');
  }

  return lines.join('\n');
}

// ── CLI ─────────────────────────────────────────────────────

function parseArgs(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      flags[key] = args[i + 1] || true;
      i++;
    } else {
      positional.push(args[i]);
    }
  }
  return { flags, positional };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log(`Linear CLI — Stream Kinetics

Commands:
  my-issues                   List my open issues
  my-todos                    List my unstarted issues
  urgent                      List urgent (P1) issues
  standup                     Daily standup summary

  issue <ID>                  View issue details (e.g., SK-123)
  create --team <KEY> --title "..." [--description "..."] [--priority <level>] [--status <name>] [--parent <ID>]
  update <ID> [--title "..."] [--status <name>] [--priority <level>]
  comment <ID> "message"      Add a comment
  status <ID> <status>        Change status (todo, progress, review, done)
  priority <ID> <level>       Set priority (urgent, high, medium, low, none)
  assign <ID> <email>         Assign to user

  search <query>              Full-text search
  teams                       List all teams
  projects                    List all projects
  project <name>              Issues for a project

Priority levels: urgent(1), high(2), medium(3), low(4), none(0)
Statuses: backlog, todo, progress, review, done, cancelled

Env: LINEAR_API_KEY (required)`);
    return;
  }

  const command = args[0];
  const { flags, positional } = parseArgs(args.slice(1));

  try {
    switch (command) {
      case 'teams': {
        const teams = await getTeams(true);
        teams.forEach((t) => console.log(`${t.key}\t${t.name}\t${t.id}`));
        break;
      }

      case 'my-issues': {
        const issues = await myIssues();
        issues.forEach((i) => console.log(formatIssue(i)));
        break;
      }

      case 'my-todos': {
        const issues = await myIssues({ state: ['unstarted'] });
        issues.forEach((i) => console.log(formatIssue(i)));
        break;
      }

      case 'urgent': {
        const data = await query(`{
          issues(first: 20, filter: { priority: { eq: 1 }, state: { type: { nin: ["completed", "canceled"] } } }) {
            nodes { identifier title team { key } state { name } assignee { name } }
          }
        }`);
        data.issues.nodes.forEach((i) => console.log(formatIssue(i)));
        break;
      }

      case 'standup': {
        const data = await standup();
        console.log(formatStandup(data));
        break;
      }

      case 'issue': {
        const id = positional[0];
        if (!id) throw new Error('Usage: issue <ID>');
        const issue = await getIssueByIdentifier(id);
        if (!issue) throw new Error(`Issue not found: ${id}`);
        // Fetch full details with the UUID
        const full = await getIssue(issue.id);
        console.log(formatIssueDetail(full));
        break;
      }

      case 'create': {
        if (!flags.team || !flags.title) throw new Error('Usage: create --team <KEY> --title "..."');
        const team = await getTeamByKey(flags.team);
        if (!team) throw new Error(`Team not found: ${flags.team}`);
        const issue = await createIssue({
          teamId: team.id,
          title: flags.title,
          description: flags.description,
          status: flags.status,
          priority: flags.priority ? PRIORITIES[flags.priority.toLowerCase()] : undefined,
          parentId: flags.parent,
        });
        console.log(`✅ Created ${issue.identifier}: ${issue.title}`);
        console.log(`   ${issue.url}`);
        break;
      }

      case 'update': {
        const id = positional[0];
        if (!id) throw new Error('Usage: update <ID> [--title ...] [--status ...] [--priority ...]');
        const issue = await getIssueByIdentifier(id);
        if (!issue) throw new Error(`Issue not found: ${id}`);

        const updateInput = {};
        if (flags.title) updateInput.title = flags.title;
        if (flags.priority) updateInput.priority = flags.priority;
        if (flags.status) {
          const stateId = await resolveStatusId(issue.team.id, flags.status);
          updateInput.stateId = stateId;
        }

        const updated = await updateIssue(issue.id, updateInput);
        console.log(`✅ Updated ${updated.identifier}: ${updated.title} → ${updated.state?.name}`);
        break;
      }

      case 'status': {
        const [id, statusName] = positional;
        if (!id || !statusName) throw new Error('Usage: status <ID> <status-name>');
        const issue = await getIssueByIdentifier(id);
        if (!issue) throw new Error(`Issue not found: ${id}`);
        const stateId = await resolveStatusId(issue.team.id, statusName);
        const updated = await updateIssue(issue.id, { stateId });
        console.log(`✅ ${updated.identifier} → ${updated.state?.name}`);
        break;
      }

      case 'priority': {
        const [id, level] = positional;
        if (!id || !level) throw new Error('Usage: priority <ID> <level>');
        const p = PRIORITIES[level.toLowerCase()];
        if (p === undefined) throw new Error(`Unknown priority: ${level}. Use: ${Object.keys(PRIORITIES).join(', ')}`);
        const issue = await getIssueByIdentifier(id);
        if (!issue) throw new Error(`Issue not found: ${id}`);
        const updated = await updateIssue(issue.id, { priority: p });
        console.log(`✅ ${updated.identifier} priority → ${level}`);
        break;
      }

      case 'assign': {
        const [id, email] = positional;
        if (!id || !email) throw new Error('Usage: assign <ID> <email>');
        const issue = await getIssueByIdentifier(id);
        if (!issue) throw new Error(`Issue not found: ${id}`);

        // If "me", use viewer
        let assigneeId;
        if (email === 'me') {
          const viewer = await query('{ viewer { id } }');
          assigneeId = viewer.viewer.id;
        } else {
          const users = await query(`{ users(filter: { email: { eq: "${escapeGql(email)}" } }) { nodes { id } } }`);
          if (!users.users.nodes.length) throw new Error(`User not found: ${email}`);
          assigneeId = users.users.nodes[0].id;
        }

        await updateIssue(issue.id, { assigneeId });
        console.log(`✅ ${issue.identifier} assigned to ${email}`);
        break;
      }

      case 'comment': {
        const id = positional[0];
        const body = positional.slice(1).join(' ') || flags.body;
        if (!id || !body) throw new Error('Usage: comment <ID> "message"');
        const issue = await getIssueByIdentifier(id);
        if (!issue) throw new Error(`Issue not found: ${id}`);
        const comment = await addComment(issue.id, body);
        console.log(`✅ Comment added to ${id} by ${comment.user?.name}`);
        break;
      }

      case 'search': {
        const q = positional.join(' ') || flags.query;
        if (!q) throw new Error('Usage: search <query>');
        const issues = await searchIssues(q);
        issues.forEach((i) => console.log(formatIssue(i)));
        break;
      }

      case 'projects': {
        const projects = await listProjects();
        projects.forEach((p) => {
          const teams = p.teams?.nodes?.map((t) => t.key).join(',') || '';
          const count = p.issues?.nodes?.length || 0;
          console.log(`${p.name}\t[${teams}]\t${count} issues\t${p.state}`);
        });
        break;
      }

      case 'project': {
        const name = positional.join(' ');
        if (!name) throw new Error('Usage: project <name>');
        const projects = await projectIssues(name);
        projects.forEach((p) => {
          console.log(`\n# ${p.name}`);
          p.issues?.nodes?.forEach((i) => console.log(`  ${formatIssue(i)}`));
        });
        break;
      }

      default:
        console.error(`Unknown command: ${command}\nRun without args for help.`);
        process.exit(1);
    }
  } catch (error) {
    console.error(`❌ ${error.message}`);
    process.exit(1);
  }
}

// ── Module Exports (for batch-populate-discovery.js) ────────
module.exports = {
  query,
  createIssue,
  updateIssue,
  getTeamByKey,
  getTeams,
  addComment,
  searchIssues,
  resolveStatusId,
  myIssues,
  standup,
  PRIORITIES,
  API_TOKEN,
};

if (require.main === module) {
  main();
}
