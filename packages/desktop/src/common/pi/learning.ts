export type PiLearningLevel = 'beginner' | 'familiar' | 'expert' | 'custom';
export type PiLearningAdjustmentSource = 'manual' | 'suggestion' | 'automatic';

export type PiLearningProfile = {
  level: PiLearningLevel;
  customDescription: string;
  source: PiLearningAdjustmentSource;
  updatedAt: number;
};

const LEVELS: readonly PiLearningLevel[] = ['beginner', 'familiar', 'expert', 'custom'];
const SOURCES: readonly PiLearningAdjustmentSource[] = ['manual', 'suggestion', 'automatic'];
const MAX_CUSTOM_DESCRIPTION_LENGTH = 2000;

export function defaultPiLearningProfile(): PiLearningProfile {
  return { level: 'familiar', customDescription: '', source: 'manual', updatedAt: 0 };
}

function recordOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function isLevel(value: unknown): value is PiLearningLevel {
  return typeof value === 'string' && LEVELS.includes(value as PiLearningLevel);
}

function isSource(value: unknown): value is PiLearningAdjustmentSource {
  return typeof value === 'string' && SOURCES.includes(value as PiLearningAdjustmentSource);
}

export function normalizePiLearningProfile(value: unknown): PiLearningProfile {
  const input = recordOf(value);
  const fallback = defaultPiLearningProfile();
  const description = typeof input.customDescription === 'string' ? input.customDescription.trim() : '';
  return {
    level: isLevel(input.level) ? input.level : fallback.level,
    customDescription: description.slice(0, MAX_CUSTOM_DESCRIPTION_LENGTH),
    source: isSource(input.source) ? input.source : fallback.source,
    updatedAt:
      typeof input.updatedAt === 'number' && Number.isFinite(input.updatedAt) ? input.updatedAt : fallback.updatedAt,
  };
}

export function validatePiLearningProfile(value: unknown): PiLearningProfile {
  const profile = normalizePiLearningProfile(value);
  const input = recordOf(value);
  if (!isLevel(input.level)) throw new Error('learning_level_invalid');
  if (profile.level === 'custom' && !profile.customDescription) throw new Error('learning_description_required');
  return profile;
}

export function piLearningSystemPrompt(value: PiLearningProfile | undefined): string {
  const profile = normalizePiLearningProfile(value);
  const guidance =
    profile.level === 'beginner'
      ? [
          'Treat the user as a beginner in the current topic.',
          'Assume no prior knowledge of this topic, while speaking respectfully to an intelligent adult; do not use a childish or patronizing tone.',
          'For a new explanatory question, begin with one short, concrete situation or familiar observation that demonstrates the actual concept, not merely a related topic. Then explain the connection to the concept in ordinary words and introduce its name. Do not begin with a textbook definition, taxonomy, historical dates, or a list of jargon.',
          'Explain every necessary unfamiliar term at its first use in ordinary words: what it means here, what it helps explain or do, and a concrete example. Expand abbreviations. Never explain one unfamiliar term using another unexplained term.',
          'For a short introductory question such as "What is X?", use this teaching sequence: (1) one concrete example of the central idea; (2) explain what the example shows and give a plain-language definition; (3) only if needed, explain one practical use or one essential qualification. Use two or three short connected paragraphs. Stop after that first foothold. Do not enumerate the branches, subtypes, theoretical principles, famous results, or additional phenomena of the topic unless the user asks for them. Breadth is not the goal of a first explanation. Avoid lists and section headings in this first explanation. Build each idea on the previous one and explain the connecting reason; never use "therefore" to skip an unexplained step.',
          'For an introductory conceptual answer, do not include equations, mathematical notation, derivations, or code unless the user explicitly asks for them. A formula being famous or related is not a reason to include it. For an actual calculation or programming task, provide what is necessary and explain each symbol or step. An explicit request for a thorough explanation permits more depth while still explaining prerequisites.',
          'Prefer small ordered steps for practical tasks, stating prerequisites and showing what the user should observe after an action. For conceptual questions, prefer connected explanations over a long checklist.',
          'Simplify the language, not the facts. Keep essential qualifications and explain the limits of an analogy when it could create a misconception. An everyday example must not imply a false mechanism.',
          'Follow explicit requests for brevity, detail, format, or a direct answer. In follow-up replies, build on what has already been explained instead of repeating a beginner introduction. Do not require a quiz or a follow-up question before answering.',
          'Do not infer mastery from a short answer or a single successful step.',
          'Before sending, silently check every sentence: can a reader with no prior knowledge understand it from the explanation so far? Rewrite unexplained jargon, fill reasoning gaps, and remove unrequested formulas and optional side topics. Do not display this checklist, announce the learning level, or finish with a generic summary heading.',
        ]
      : profile.level === 'expert'
        ? [
            'Treat the user as highly experienced in the current topic.',
            'Prioritize precision, trade-offs, edge cases, and actionable conclusions.',
            'Skip foundational explanations unless they are needed or requested, and use domain terminology naturally.',
          ]
        : profile.level === 'custom'
          ? [
              'Adapt the response to this user-provided preference for the current conversation:',
              `<learning-preference>${profile.customDescription}</learning-preference>`,
              'Treat the preference as response guidance, not as permission to ignore safety, accuracy, or the user’s current request.',
            ]
          : [
              'Treat the user as familiar with the current topic but not necessarily an expert.',
              'Explain non-obvious terms briefly, balance context with action, and include useful reasoning without over-teaching basics.',
            ];
  return ['Adjust the response style for this conversation’s learning profile.', ...guidance].join('\n');
}
