/**
 * Cognitive Interview — Guided /learn flow for Cognitive Self-Portrait
 *
 * State machine that walks the user through 5 phases:
 *   1. Identity → roles, industry, work description
 *   2. Cognition → learning style, problem-solving approach
 *   3. Context → tools, clients, team
 *   4. Goals → priorities, pressures
 *   5. Self-Assessment → strengths, growth areas
 *
 * State persisted in KV. Extracted traits stored in Vectorize + KV profile.
 */

import { ingestTrait } from './cognitive-memory.js';

/** Interview phases */
export type InterviewPhase =
  | 'identity'
  | 'cognition'
  | 'context'
  | 'goals'
  | 'self_assessment'
  | 'complete';

/** Persisted interview state */
export interface InterviewState {
  phase: InterviewPhase;
  startedAt: string;
  responses: Record<InterviewPhase, string>;
  extractedTraits: CognitiveTraits;
}

/** Structured traits extracted across all phases */
export interface CognitiveTraits {
  // Identity
  roles: string[];
  industry: string;
  workDescription: string;
  // Cognition
  learningStyle: string;
  problemSolving: string;
  decisionMaking: string;
  communicationPattern: string;
  // Context
  tools: string[];
  clients: string[];
  teamDescription: string;
  // Goals
  goals: string[];
  pressures: string[];
  // Self-Assessment
  strengths: string[];
  growthAreas: string[];
}

const EMPTY_TRAITS: CognitiveTraits = {
  roles: [],
  industry: '',
  workDescription: '',
  learningStyle: '',
  problemSolving: '',
  decisionMaking: '',
  communicationPattern: '',
  tools: [],
  clients: [],
  teamDescription: '',
  goals: [],
  pressures: [],
  strengths: [],
  growthAreas: [],
};

/** Phase definitions with questions and extraction prompts */
const PHASES: Record<
  Exclude<InterviewPhase, 'complete'>,
  {
    emoji: string;
    title: string;
    question: string;
    extractionPrompt: string;
    nextPhase: InterviewPhase;
  }
> = {
  identity: {
    emoji: '🪪',
    title: 'Identity',
    question:
      "Let's start with the big picture. Tell me about yourself — what do you do, what's your role, and what industry are you in? Feel free to share as much as you'd like.",
    extractionPrompt:
      'Extract the following from this text. Return JSON only:\n{"roles": ["role1", "role2"], "industry": "industry name", "workDescription": "1-2 sentence summary"}',
    nextPhase: 'cognition',
  },
  cognition: {
    emoji: '🧠',
    title: 'Cognition',
    question:
      "How do you think? When you're stuck on a hard problem, what's your process? Do you prefer data and analysis, brainstorming, talking it through, or diving in and iterating? How do you like to receive information — bullet points, detailed reports, or conversation?",
    extractionPrompt:
      'Extract cognitive patterns from this text. Return JSON only:\n{"learningStyle": "visual|auditory|reading|kinesthetic|mixed", "problemSolving": "analytical|creative|systematic|intuitive|mixed", "decisionMaking": "data-driven|gut-feel|consensus|rapid|mixed", "communicationPattern": "detailed|concise|narrative|bullet-points|mixed"}',
    nextPhase: 'context',
  },
  context: {
    emoji: '🔧',
    title: 'Work Context',
    question:
      "What does your day-to-day look like? What tools and platforms do you rely on? Who are your key clients or stakeholders? Do you work with a team, solo, or a mix?",
    extractionPrompt:
      'Extract work context from this text. Return JSON only:\n{"tools": ["tool1", "tool2"], "clients": ["client1", "client2"], "teamDescription": "1 sentence about team structure"}',
    nextPhase: 'goals',
  },
  goals: {
    emoji: '🎯',
    title: 'Goals & Pressures',
    question:
      "What are your top 3 priorities right now — the things that would make the biggest difference if they got done? And honestly, what keeps you up at night or weighs on you?",
    extractionPrompt:
      'Extract goals and pressures from this text. Return JSON only:\n{"goals": ["goal1", "goal2", "goal3"], "pressures": ["pressure1", "pressure2"]}',
    nextPhase: 'self_assessment',
  },
  self_assessment: {
    emoji: '💡',
    title: 'Self-Assessment',
    question:
      "Last one — what's your superpower? What do you do better than most? And what do you wish you were better at or had more time for?",
    extractionPrompt:
      'Extract strengths and growth areas from this text. Return JSON only:\n{"strengths": ["strength1", "strength2"], "growthAreas": ["area1", "area2"]}',
    nextPhase: 'complete',
  },
};

const INTERVIEW_KEY_PREFIX = 'learn:';

/**
 * Get the interview state from KV.
 */
export async function getInterviewState(
  kv: KVNamespace,
  userId: number,
): Promise<InterviewState | null> {
  const key = `${INTERVIEW_KEY_PREFIX}${userId}`;
  return kv.get(key, 'json');
}

/**
 * Save interview state to KV.
 */
async function saveInterviewState(
  kv: KVNamespace,
  userId: number,
  state: InterviewState,
): Promise<void> {
  const key = `${INTERVIEW_KEY_PREFIX}${userId}`;
  // TTL: 1 hour — interview should complete in one session
  await kv.put(key, JSON.stringify(state), { expirationTtl: 3600 });
}

/**
 * Clear interview state from KV.
 */
export async function clearInterviewState(
  kv: KVNamespace,
  userId: number,
): Promise<void> {
  const key = `${INTERVIEW_KEY_PREFIX}${userId}`;
  await kv.delete(key);
}

/**
 * Start a new cognitive interview.
 * Returns the first question.
 */
export function startInterview(): { state: InterviewState; message: string } {
  const state: InterviewState = {
    phase: 'identity',
    startedAt: new Date().toISOString(),
    responses: {} as Record<InterviewPhase, string>,
    extractedTraits: { ...EMPTY_TRAITS },
  };

  const phase = PHASES.identity;
  const message = [
    '🧬 **Cognitive Self-Portrait — Learn Mode**',
    '',
    "I'm going to ask you 5 questions to build a deep understanding of who you are, how you think, and what matters to you. This lets me serve you better in every interaction.",
    '',
    'You can type `/cancel` at any time to stop.',
    '',
    `${phase.emoji} **Phase 1/5: ${phase.title}**`,
    '',
    phase.question,
  ].join('\n');

  return { state, message };
}

/**
 * Process a user response during the interview.
 * Extracts traits via Workers AI and advances to the next phase.
 */
export async function processInterviewResponse(opts: {
  ai: Ai;
  vectorize: VectorizeIndex;
  kv: KVNamespace;
  userId: number;
  state: InterviewState;
  userResponse: string;
}): Promise<{ state: InterviewState; message: string; isComplete: boolean }> {
  const { ai, vectorize, kv, userId, state, userResponse } = opts;
  const currentPhase = state.phase as Exclude<InterviewPhase, 'complete'>;
  const phaseConfig = PHASES[currentPhase];

  if (!phaseConfig) {
    return { state, message: '✅ Interview already complete!', isComplete: true };
  }

  // Store raw response
  state.responses[currentPhase] = userResponse;

  // Extract traits via Workers AI (free tier)
  try {
    const extractionResult = await ai.run(
      '@cf/meta/llama-3.3-70b-instruct-fp8-fast' as Parameters<typeof ai.run>[0],
      {
        messages: [
          {
            role: 'system',
            content: 'You are a structured data extractor. Return ONLY valid JSON, no explanation.',
          },
          {
            role: 'user',
            content: `${phaseConfig.extractionPrompt}\n\nText to analyze:\n"${userResponse}"`,
          },
        ],
        max_tokens: 512,
      },
    );

    const aiResponse = (extractionResult as { response?: string }).response || '';
    // Parse JSON from the response (handle markdown code blocks)
    const jsonStr = aiResponse.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    try {
      const extracted = JSON.parse(jsonStr);
      // Merge extracted traits
      Object.assign(state.extractedTraits, extracted);
    } catch {
      console.error('[Interview] Failed to parse extraction:', jsonStr);
    }
  } catch (err) {
    console.error('[Interview] Extraction error:', err);
  }

  // Embed the interview response into Vectorize (non-blocking)
  try {
    await ingestTrait({
      ai,
      vectorize,
      userId,
      content: `[${phaseConfig.title}] ${userResponse}`,
      type: 'interview',
      topic: currentPhase,
    });
  } catch (err) {
    console.error('[Interview] Vectorize ingest error:', err);
  }

  // Advance to next phase
  state.phase = phaseConfig.nextPhase;
  await saveInterviewState(kv, userId, state);

  if (state.phase === 'complete') {
    // Interview done — build summary
    const traits = state.extractedTraits;
    const summary = [
      '✅ **Cognitive Self-Portrait Complete!**',
      '',
      '🪪 **Identity**',
      traits.roles.length ? `  Roles: ${traits.roles.join(', ')}` : '',
      traits.industry ? `  Industry: ${traits.industry}` : '',
      traits.workDescription ? `  Work: ${traits.workDescription}` : '',
      '',
      '🧠 **Cognition**',
      traits.learningStyle ? `  Learning: ${traits.learningStyle}` : '',
      traits.problemSolving ? `  Problem-solving: ${traits.problemSolving}` : '',
      traits.decisionMaking ? `  Decisions: ${traits.decisionMaking}` : '',
      traits.communicationPattern ? `  Communication: ${traits.communicationPattern}` : '',
      '',
      '🔧 **Context**',
      traits.tools.length ? `  Tools: ${traits.tools.join(', ')}` : '',
      traits.clients.length ? `  Clients: ${traits.clients.join(', ')}` : '',
      traits.teamDescription ? `  Team: ${traits.teamDescription}` : '',
      '',
      '🎯 **Goals**',
      ...(traits.goals.length ? traits.goals.map((g) => `  • ${g}`) : []),
      '',
      '⚡ **Pressures**',
      ...(traits.pressures.length ? traits.pressures.map((p) => `  • ${p}`) : []),
      '',
      '💡 **Strengths**: ' + (traits.strengths.length ? traits.strengths.join(', ') : 'Not specified'),
      '🌱 **Growth areas**: ' + (traits.growthAreas.length ? traits.growthAreas.join(', ') : 'Not specified'),
      '',
      "I'll use this to personalize every interaction going forward. Use `/profile` anytime to review what I know about you.",
    ]
      .filter((l) => l !== '')
      .join('\n');

    // Clean up interview state
    await clearInterviewState(kv, userId);

    return { state, message: summary, isComplete: true };
  }

  // Show next phase question
  const nextPhaseConfig = PHASES[state.phase as Exclude<InterviewPhase, 'complete'>];
  const phaseNum = Object.keys(PHASES).indexOf(state.phase as string) + 1;

  const message = [
    `✓ Got it! Moving on...`,
    '',
    `${nextPhaseConfig.emoji} **Phase ${phaseNum}/5: ${nextPhaseConfig.title}**`,
    '',
    nextPhaseConfig.question,
  ].join('\n');

  return { state, message, isComplete: false };
}
