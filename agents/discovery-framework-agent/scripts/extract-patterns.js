#!/usr/bin/env node

/**
 * Discovery Framework Agent — Pattern Extraction
 * Parse client transcripts and extract discovery patterns into structured JSON
 * Input: Transcript (PDF, text, JSON)
 * Output: Structured discovery object for downstream agents
 */

const fs = require('fs');
const path = require('path');

/**
 * Parse transcript text and extract patterns
 * Uses simple heuristics + pattern matching
 * @param {string} transcript - Raw transcript text
 * @returns {Object} Structured discovery data
 */
function extractDiscoveryPatterns(transcript) {
  const discovery = {
    extracted_at: new Date().toISOString(),
    client_name: extractClientName(transcript),
    initiative: null,
    pain_points: extractPainPoints(transcript),
    opportunities: extractOpportunities(transcript),
    tech_stack: extractTechStack(transcript),
    team_context: extractTeamContext(transcript),
    success_metrics: extractSuccessMetrics(transcript),
    decision_makers: extractDecisionMakers(transcript),
    timeline: extractTimeline(transcript),
    budget_signals: extractBudgetSignals(transcript),
    confidence_score: calculateConfidence(transcript)
  };

  return discovery;
}

/**
 * Extract client/company name from transcript
 */
function extractClientName(text) {
  // Look for patterns like "Hi [Name]", "Welcome [Company]", etc.
  const patterns = [
    /(?:Hi|Hello|Welcome|This is|I'm calling|speaking with)\s+([A-Z][a-zA-Z\s]+?)(?:\.|,|\s(?:from|at|with))/,
    /(?:company|organization|church|practice|firm)(?:\s+name)?:?\s*([A-Z][a-zA-Z\s&]+?)(?:\.|,)/i,
    /^([A-Z][a-zA-Z\s&]+?)(?:\s+Church|\s+LLC|\s+Inc|\s+Corp)/m
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  return 'Unknown Client';
}

/**
 * Extract pain points from transcript
 */
function extractPainPoints(text) {
  const painPoints = [];
  
  // Keywords that signal pain points
  const painKeywords = [
    'problem', 'pain', 'struggle', 'challenge', 'difficult', 'frustrated',
    'bottleneck', 'inefficient', 'manual', 'time-consuming', 'broken',
    'doesn\'t work', 'can\'t', 'unable to', 'waste', 'slow'
  ];

  const sentences = text.match(/[^.!?]*[.!?]+/g) || [];
  
  for (const sentence of sentences) {
    for (const keyword of painKeywords) {
      if (sentence.toLowerCase().includes(keyword)) {
        // Extract the full thought around the keyword
        const cleaned = sentence.replace(/^[•\-\*]\s*/, '').trim();
        if (cleaned.length > 20 && painPoints.length < 10) {
          if (!painPoints.includes(cleaned)) {
            painPoints.push(cleaned);
          }
        }
        break;
      }
    }
  }

  return painPoints;
}

/**
 * Extract opportunities from transcript
 */
function extractOpportunities(text) {
  const opportunities = [];
  
  const opportunityKeywords = [
    'opportunity', 'potential', 'could', 'would help', 'looking for',
    'interested in', 'want to', 'need to', 'should', 'imagine',
    'better way', 'improve', 'automate'
  ];

  const sentences = text.match(/[^.!?]*[.!?]+/g) || [];
  
  for (const sentence of sentences) {
    for (const keyword of opportunityKeywords) {
      if (sentence.toLowerCase().includes(keyword)) {
        const cleaned = sentence.replace(/^[•\-\*]\s*/, '').trim();
        if (cleaned.length > 20 && opportunities.length < 8) {
          if (!opportunities.includes(cleaned)) {
            opportunities.push(cleaned);
          }
        }
        break;
      }
    }
  }

  return opportunities;
}

/**
 * Extract tech stack from transcript
 */
function extractTechStack(text) {
  const techStack = {
    current: {},
    desired: {}
  };

  // Common tech categories and patterns
  const techPatterns = {
    'CRM': /(?:crm|customer relationship management|salesforce|hubspot|pipedrive)/gi,
    'ERP': /(?:erp|enterprise resource|sap|oracle|netsuite)/gi,
    'Databases': /(?:database|postgres|mysql|mongodb|sql|sqlite|firebase)/gi,
    'Cloud': /(?:aws|azure|gcp|cloudflare|heroku)/gi,
    'Backend': /(?:node|python|java|go|rust|c\#|ruby|php)/gi,
    'Frontend': /(?:react|vue|angular|svelte|next\.js)/gi,
    'Auth': /(?:oauth|saml|okta|auth0|ldap)/gi,
    'Integration': /(?:zapier|make|api|webhook|rest|graphql)/gi,
    'Analytics': /(?:analytics|tableau|looker|mixpanel|amplitude)/gi,
    'Communication': /(?:slack|teams|discord|email|sms|twilio)/gi
  };

  // Extract tech mentions
  for (const [category, pattern] of Object.entries(techPatterns)) {
    const matches = text.match(pattern);
    if (matches) {
      // Track unique mentions
      const tech = matches[0].toLowerCase();
      if (!techStack.current[category]) {
        techStack.current[category] = tech;
      }
    }
  }

  // Look for "switching to", "moving to", "want to use" patterns
  const switchPatterns = text.match(/(?:moving to|switching to|want to use|plan to use|looking at)\s+([A-Za-z0-9\s\.]+?)(?:\.|,|\s(?:for|because))/gi) || [];
  
  switchPatterns.forEach((match, i) => {
    const tech = match.replace(/^(?:moving to|switching to|want to use|plan to use|looking at)\s+/, '').trim();
    if (i < 3) {
      const category = guessTechCategory(tech);
      if (category) {
        techStack.desired[category] = tech;
      }
    }
  });

  return techStack;
}

/**
 * Guess technology category
 */
function guessTechCategory(techName) {
  const categories = {
    'CRM': ['crm', 'salesforce', 'hubspot', 'pipedrive', 'zendesk'],
    'ERP': ['erp', 'sap', 'oracle', 'netsuite'],
    'Databases': ['postgres', 'mysql', 'mongodb', 'firebase', 'sql'],
    'Cloud': ['aws', 'azure', 'gcp', 'cloudflare'],
    'Backend': ['node', 'python', 'java', 'go', 'rust'],
    'Frontend': ['react', 'vue', 'angular'],
  };

  const lowerName = techName.toLowerCase();
  for (const [cat, techs] of Object.entries(categories)) {
    if (techs.some(t => lowerName.includes(t))) {
      return cat;
    }
  }

  return null;
}

/**
 * Extract team context
 */
function extractTeamContext(text) {
  const context = {
    industry: null,
    team_size: null,
    timeline: null,
    budget_range: null
  };

  // Industry detection
  const industryPatterns = {
    'Healthcare': /(?:hospital|clinic|practice|healthcare|medical|patient|doctor)/gi,
    'Education': /(?:school|university|student|academic|course|training)/gi,
    'Non-profit': /(?:nonprofit|church|charity|foundation|mission)/gi,
    'Finance': /(?:bank|financial|investment|lending)/gi,
    'Retail': /(?:store|shop|retail|ecommerce|commerce)/gi,
    'Technology': /(?:tech|software|startup|app|platform)/gi
  };

  for (const [industry, pattern] of Object.entries(industryPatterns)) {
    if (text.match(pattern)) {
      context.industry = industry;
      break;
    }
  }

  // Team size
  const sizeMatch = text.match(/(\d+)\s+(?:person|people|staff|team|employee)/i);
  if (sizeMatch) {
    context.team_size = `~${sizeMatch[1]} people`;
  }

  // Timeline signals
  if (text.match(/asap|urgent|this month|this week/i)) {
    context.timeline = 'Urgent (weeks)';
  } else if (text.match(/next month|this quarter|3 months/i)) {
    context.timeline = 'Near-term (1-3 months)';
  } else if (text.match(/next year|6 months|long-term/i)) {
    context.timeline = 'Long-term (6+ months)';
  }

  return context;
}

/**
 * Extract success metrics from transcript
 */
function extractSuccessMetrics(text) {
  const metrics = [];

  const metricKeywords = [
    'reduce', 'increase', 'improve', 'save', 'faster', 'more', 'less',
    'percent', 'hours', 'days', 'efficiency', 'productivity', 'revenue'
  ];

  // Look for numeric targets
  const numberPatterns = text.match(/(?:reduce|save|increase|improve)\s+(?:by\s+)?(\d+)(?:%|%?|\s+(?:percent|hours|days))/gi) || [];
  
  numberPatterns.forEach(pattern => {
    metrics.push(pattern.trim());
  });

  // Look for outcome statements
  const outcomePatterns = text.match(/(?:goal|success|target|metric|kpi)[\w\s:]*?(?:is|are|would be)\s+([^.!?]+)(?:[.!?])/gi) || [];
  
  outcomePatterns.slice(0, 3).forEach(pattern => {
    const cleaned = pattern.replace(/(?:goal|success|target|metric|kpi)[\w\s:]*/i, '').trim();
    if (cleaned.length > 10 && !metrics.includes(cleaned)) {
      metrics.push(cleaned);
    }
  });

  return metrics;
}

/**
 * Extract decision makers from transcript
 */
function extractDecisionMakers(text) {
  const makers = [];

  // Look for titles/names
  const titlePatterns = [
    /(?:I'm|I am|this is)\s+([A-Z][a-zA-Z]+)\s+(?:the\s+)?(\w+\s+\w+)/gi,
    /(?:we have|our\s+)?(\w+\s+officer|director|manager|lead)\s+(?:named\s+)?([A-Z][a-zA-Z]+)/gi
  ];

  titlePatterns.forEach(pattern => {
    const matches = [...text.matchAll(pattern)];
    matches.slice(0, 3).forEach(match => {
      makers.push({
        name: match[1] || 'Unknown',
        title: match[2] || match[1] || 'Unknown'
      });
    });
  });

  return makers;
}

/**
 * Extract timeline signals from transcript
 */
function extractTimeline(text) {
  const timelineSignals = {
    immediate: text.match(/asap|urgent|right away|immediately|this week/i) ? true : false,
    near_term: text.match(/next month|1-3 months|this quarter/i) ? true : false,
    medium_term: text.match(/6 months|mid-year|q3|q4/i) ? true : false,
    long_term: text.match(/next year|12 months|2024|2025/i) ? true : false
  };

  return timelineSignals;
}

/**
 * Extract budget signals from transcript
 */
function extractBudgetSignals(text) {
  const signals = {
    mentioned: false,
    estimated_range: null,
    confidence: 'low'
  };

  // Look for budget mentions
  const budgetPatterns = [
    /budget[\w\s]*?(?:is|of|around)[\w\s]*?\$(\d+)(?:k|K)?/i,
    /(?:spend|invest|allocate)[\w\s]*?\$(\d+)(?:k|K)?/i,
    /(\d+)(?:k|K)\s+(?:budget|investment|spending)/i
  ];

  for (const pattern of budgetPatterns) {
    const match = text.match(pattern);
    if (match) {
      signals.mentioned = true;
      const amount = parseInt(match[1]) * (match[0].includes('k') || match[0].includes('K') ? 1000 : 1);
      signals.estimated_range = `$${amount.toLocaleString()}+`;
      signals.confidence = 'medium';
      break;
    }
  }

  return signals;
}

/**
 * Calculate confidence score (0-100)
 */
function calculateConfidence(text) {
  let score = 50; // baseline

  // Add points for signal strength
  if (text.length > 2000) score += 10;
  if (text.match(/budget|spend|invest/i)) score += 10;
  if (text.match(/timeline|urgent|asap|when/i)) score += 5;
  if (text.match(/problem|pain|challenge/i)) score += 10;
  if (text.match(/\$\d+/)) score += 15;
  if (text.match(/decision|approve|stakeholder/i)) score += 10;

  // Deduct for vagueness
  if (text.length < 500) score -= 15;
  if (!text.match(/timeline|urgent|asap|when|month/i)) score -= 10;

  return Math.min(100, Math.max(0, score));
}

/**
 * Load transcript from file
 */
function loadTranscript(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  
  if (ext === '.json') {
    try {
      const data = fs.readFileSync(filePath, 'utf-8');
      const json = JSON.parse(data);
      // Extract text from common fields
      return json.text || json.transcript || json.content || JSON.stringify(json);
    } catch (error) {
      throw new Error(`Failed to parse JSON: ${error.message}`);
    }
  } else if (ext === '.txt') {
    return fs.readFileSync(filePath, 'utf-8');
  } else if (ext === '.pdf') {
    throw new Error('PDF parsing not yet implemented. Please convert PDF to text first.');
  } else {
    throw new Error(`Unsupported file type: ${ext}`);
  }
}

/**
 * CLI Interface
 */
async function main() {
  const [filePath] = process.argv.slice(2);

  if (!filePath) {
    console.log(`Usage:
  node extract-patterns.js <transcript-file>

Supported formats:
  - .txt  — Plain text transcript
  - .json — JSON with 'text', 'transcript', or 'content' field
  - .pdf  — (convert to .txt first)

Example:
  node extract-patterns.js client-call.txt
  node extract-patterns.js discovery-call.json

Output: Structured JSON discovery object (stdout)
`);
    process.exit(1);
  }

  try {
    console.error(`📖 Reading transcript from ${filePath}...`);
    const transcript = loadTranscript(filePath);
    
    console.error(`🔍 Extracting patterns...\n`);
    const discovery = extractDiscoveryPatterns(transcript);
    
    console.log(JSON.stringify(discovery, null, 2));
    
    console.error(`\n✅ Extraction complete! (Confidence: ${discovery.confidence_score}%)`);
    console.error(`\n📊 Summary:`);
    console.error(`  Pain Points: ${discovery.pain_points.length}`);
    console.error(`  Opportunities: ${discovery.opportunities.length}`);
    console.error(`  Tech Stack (current): ${Object.keys(discovery.tech_stack.current).length}`);
    console.error(`  Tech Stack (desired): ${Object.keys(discovery.tech_stack.desired).length}`);

  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  extractDiscoveryPatterns,
  extractClientName,
  extractPainPoints,
  extractOpportunities,
  extractTechStack,
  extractTeamContext,
  extractSuccessMetrics,
  loadTranscript
};
