// Deterministic workout negotiator. Ported from the rules engine in the root index.html prototype.
// server.ts calls evaluateMultiTurnConversation() then generateAdaptiveProposal(); an LLM may
// only reword proposal.message, so every plan decision is made here.

export interface Exercise {
  name: string;
  minutes: number;
  /** Primary compound lift: protected when pruning. */
  compound: boolean;
  /** Higher = pruned later. */
  priority: number;
}

export interface ChatMessage {
  role: string;
  text: string;
}

export interface CurrentPlan {
  day?: string;
  name?: string;
  exercises?: Exercise[];
}

export interface Slot {
  day: string;
  time: string;
}

export type LatenessSeverity = 'none' | 'mild' | 'moderate' | 'severe' | 'sleep-risk';
export type Level = 'low' | 'moderate' | 'high';
export type ProposalType = 'full' | 'compressed' | 'shift' | 'rest';

export interface Observation {
  detectedDay: string | null;
  /** Hour of day as a decimal (21.5 = 9:30 PM), or null. */
  detectedHour: number | null;
  detectedTime: string | null;
  availableMinutes: number | null;
  latenessSeverity: LatenessSeverity;
  stressLevel: Level;
  /** 0-10 */
  stressScore: number;
  energyLevel: Level;
  wantsRest: boolean;
  wantsSolo: boolean;
  /** True when any schedule or energy detail was found in the user's messages. */
  hasSignal: boolean;
  inferredConstraints: string[];
}

export interface Proposal {
  type: ProposalType;
  title: string;
  message: string;
  proposedPlan: { name: string; durationMinutes: number; exercises: Exercise[] };
  keptExercises: Exercise[];
  removedExercises: Exercise[];
  rescheduledSlot: Slot | null;
  /** True when today should count as an Intentional Rest Day in the streak. */
  intentionalRest: boolean;
}

export interface UserPreferences {
  notes?: string[];
  /** Shortest session worth building, default 15. */
  minSessionMinutes?: number;
  /** Where pruned work or moved sessions land, default 7:00 AM. */
  rescheduleTime?: string;
}

export interface PartnerState {
  sharedSlots?: Slot[];
  [key: string]: unknown;
}

export const DEFAULT_EXERCISES: Exercise[] = [
  { name: 'Back Squat', minutes: 15, compound: true, priority: 9 },
  { name: 'Romanian Deadlift', minutes: 12, compound: true, priority: 9 },
  { name: 'Reformer Lunges', minutes: 10, compound: false, priority: 3 },
  { name: 'Core Circuit', minutes: 8, compound: false, priority: 2 },
  { name: 'Band Hip Thrust', minutes: 8, compound: false, priority: 1 },
  { name: 'Kettlebell Swings', minutes: 7, compound: false, priority: 0 },
];

const FULL_NAME = 'Lower Body Reformer & Core';
const NUM: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
};
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Lowercase, and turn spelled-out numbers and "9 30 pm" into digits so the regexes below can match. */
function normalize(text: string): string {
  let s = text
    .toLowerCase()
    .replace(/\b([ap])\.\s?m\.?/g, '$1m')
    .replace(/o'clock/g, '')
    .replace(/\bhalf an hour\b/g, '30 minutes')
    .replace(/\ban hour\b/g, '60 minutes');
  s = s.replace(
    /\b(twenty|thirty|forty|fifty|sixty)[\s-](one|two|three|four|five|six|seven|eight|nine)\b/g,
    (_m, a: string, b: string) => String(NUM[a] + NUM[b]),
  );
  s = s.replace(new RegExp(`\\b(${Object.keys(NUM).join('|')})\\b`, 'g'), (m) => String(NUM[m]));
  return s.replace(/\b(\d{1,2})\s(\d{2})\s*(am|pm)\b/g, '$1:$2 $3');
}

export function formatHour(h: number): string {
  const hours = Math.floor(h);
  const mins = Math.round((h - hours) * 60);
  return `${hours % 12 || 12}${mins ? ':' + String(mins).padStart(2, '0') : ''} ${hours < 12 ? 'AM' : 'PM'}`;
}

interface Parsed {
  hour: number | null;
  minutes: number | null;
  rest: boolean;
  stress: boolean;
  tired: boolean;
  solo: boolean;
  usual: boolean;
  day: string | null;
}

function parseMessage(text: string): Parsed {
  const s = normalize(text);

  // Take the last time mentioned ("can't make 6:30, but 8:30 works" means 8:30). A bare "6:30" with no
  // am/pm is read as evening, since this app is about late arrivals; 13:00-23:59 is read as 24-hour.
  let hour: number | null = null;
  for (const t of s.matchAll(/\b(\d{1,2})(?::([0-5]\d))?\s*(am|pm)?\b/g)) {
    if (!t[2] && !t[3]) continue;
    const x = +t[1];
    const frac = (+t[2] || 0) / 60;
    if (t[3]) {
      if (x >= 1 && x <= 12) hour = (x % 12) + (t[3] === 'pm' ? 12 : 0) + frac;
    } else if (x <= 23) {
      hour = (x >= 1 && x <= 11 ? x + 12 : x) + frac;
    }
  }

  let minutes: number | null = null;
  const mn = s.match(/\b(\d{1,3})\s*(?:min|mins|minutes)\b/);
  const hr = s.match(/\b(\d(?:\.\d)?)\s*(?:hours?|hrs?)\b/);
  if (mn) minutes = +mn[1];
  else if (hr) minutes = Math.round(+hr[1] * 60);

  const dayMatch = s.match(/\b(mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?\b/);
  const day = dayMatch ? WEEKDAYS.find((d) => d.toLowerCase().startsWith(dayMatch[1].slice(0, 3))) ?? null : null;

  return {
    hour,
    minutes,
    day,
    rest: /\b(rest|skip|day off|no workout)\b/.test(s),
    stress: /\b(stress\w*|deadlines?|overwhelm\w*|swamped|slammed|meetings?|overrun|busy|work(?!\s*out)|working(?!\s*out)|late)\b/.test(s),
    tired: /\b(tired|exhausted|sore|drained|wiped|fatigue\w*|sleepy)\b/.test(s),
    solo: /\b(solo|alone|by myself|on my own|individual(ly)?)\b/.test(s),
    usual: /\b(like usual|as usual|as planned|as scheduled|same as (always|usual)|full (workout|session|plan)|regular (workout|session|plan)|normal (workout|session|plan))\b/.test(s),
  };
}

function levelOf(score: number): Level {
  return score >= 7 ? 'high' : score >= 4 ? 'moderate' : 'low';
}

function severityOf(hour: number | null): LatenessSeverity {
  if (hour == null) return 'none';
  if (hour >= 23 || hour < 5) return 'sleep-risk';
  if (hour > 21) return 'severe';
  if (hour > 20) return 'moderate';
  if (hour > 19) return 'mild';
  return 'none';
}

/**
 * Reads the whole conversation but only the user's turns. Schedule facts (time, minutes, day) come
 * from the most recent message that states them; stress and tiredness carry across turns.
 */
export function evaluateMultiTurnConversation(messages: ChatMessage[] = []): Observation {
  const userTurns = messages.filter((m) => m?.role === 'user' && m.text).map((m) => parseMessage(m.text));
  const latest = <K extends keyof Parsed>(key: K): Parsed[K] | null => {
    for (let i = userTurns.length - 1; i >= 0; i--) {
      if (userTurns[i][key] != null) return userTurns[i][key];
    }
    return null;
  };

  const hour = latest('hour') as number | null;
  const minutes = latest('minutes') as number | null;
  const last = userTurns[userTurns.length - 1];
  const wantsRest = Boolean(last?.rest);
  const wantsSolo = userTurns.some((t) => t.solo);
  const wantsUsual = userTurns.some((t) => t.usual);
  const stressed = userTurns.some((t) => t.stress);
  const tired = userTurns.some((t) => t.tired);

  const severity = severityOf(hour);
  const stressScore = Math.min(10, (stressed ? 5 : 0) + (severity === 'severe' || severity === 'sleep-risk' ? 3 : severity === 'moderate' ? 2 : 0) + (tired ? 1 : 0));

  const constraints: string[] = [];
  if (hour != null) constraints.push(`Available from ${formatHour(hour)}`);
  if (minutes != null) constraints.push(`${minutes} minutes available`);
  if (stressed) constraints.push('Work or schedule stress');
  if (tired) constraints.push('Low energy');
  if (severity === 'sleep-risk') constraints.push('Protect sleep (past 11 PM)');
  if (wantsRest) constraints.push('Athlete chose to rest');
  if (wantsSolo) constraints.push('Prefers to train solo');

  return {
    detectedDay: (latest('day') as string | null) ?? null,
    detectedHour: hour,
    detectedTime: hour != null ? formatHour(hour) : null,
    availableMinutes: minutes,
    latenessSeverity: severity,
    stressLevel: levelOf(stressScore),
    stressScore,
    energyLevel: tired ? 'low' : stressed ? 'moderate' : 'high',
    wantsRest,
    wantsSolo,
    hasSignal: hour != null || minutes != null || wantsRest || stressed || tired || wantsSolo || wantsUsual,
    inferredConstraints: constraints,
  };
}

function nextDay(day: string | null | undefined): string {
  const i = WEEKDAYS.findIndex((d) => d === day);
  return i >= 0 ? WEEKDAYS[(i + 1) % 7] : 'Tomorrow';
}

function sum(exercises: Exercise[]): number {
  return exercises.reduce((total, e) => total + e.minutes, 0);
}

function sharedWith(partnerState: PartnerState | undefined, slot: Slot): boolean {
  return Boolean(partnerState?.sharedSlots?.some((s) => s.time === slot.time && (s.day === slot.day || slot.day === 'Tomorrow')));
}

/** Builds the adapted session. Compound lifts are always the last thing pruned. */
export function generateAdaptiveProposal(
  currentPlan: CurrentPlan | undefined,
  observation: Observation,
  _messages: ChatMessage[] = [],
  partnerState?: PartnerState,
  _autonomyState?: unknown,
  userPreferences?: UserPreferences,
): Proposal {
  const full = currentPlan?.exercises?.length ? currentPlan.exercises : DEFAULT_EXERCISES;
  const fullName = currentPlan?.name || FULL_NAME;
  const fullMinutes = sum(full);
  const minSession = userPreferences?.minSessionMinutes ?? 15;
  const moveTime = userPreferences?.rescheduleTime ?? '7:00 AM';
  const tomorrow = nextDay(observation.detectedDay ?? currentPlan?.day);
  const o = observation;

  if (o.wantsRest) {
    const slot = { day: tomorrow, time: moveTime };
    return {
      type: 'rest',
      title: 'Intentional Rest Day',
      message: `Totally fine, rest is part of the plan. Today is logged as an Intentional Rest Day, so your streak stays safe. The full session moves to ${slot.day} ${slot.time}.`,
      proposedPlan: { name: 'Intentional Rest Day', durationMinutes: 0, exercises: [] },
      keptExercises: [],
      removedExercises: full,
      rescheduledSlot: slot,
      intentionalRest: true,
    };
  }

  // Late arrivals shift forward to the next day, never backward.
  if (o.latenessSeverity === 'sleep-risk' && o.detectedHour != null) {
    const slot = { day: tomorrow, time: '6:30 PM' };
    const partner = sharedWith(partnerState, slot) ? ' Your partner is also booked then, so you can train together.' : '';
    return {
      type: 'shift',
      title: 'Session moved to tomorrow',
      message: `Training at ${formatHour(o.detectedHour)} would cut into your sleep, so I've moved the full ${fullMinutes}-min session to ${slot.day} ${slot.time}. Nothing is lost.${partner}`,
      proposedPlan: { name: `${fullName} · moved`, durationMinutes: fullMinutes, exercises: full },
      keptExercises: full,
      removedExercises: [],
      rescheduledSlot: slot,
      intentionalRest: false,
    };
  }

  let budget =
    o.availableMinutes ??
    (o.detectedHour != null ? (o.detectedHour <= 19 ? fullMinutes : o.detectedHour <= 20 ? 45 : o.detectedHour <= 21 ? 30 : 20) : fullMinutes);

  const why: string[] = [];
  if (o.availableMinutes != null) why.push(`the ${o.availableMinutes} min you have`);
  else if (o.detectedHour != null && budget < fullMinutes) why.push(`a ~${formatHour(o.detectedHour)} start`);
  if (o.stressScore >= 4) {
    budget -= 10;
    why.push('work stress');
  }
  if (o.energyLevel === 'low') {
    budget -= 10;
    why.push('low energy');
  }
  const raw = budget;
  budget = Math.max(minSession, Math.min(fullMinutes, budget));

  const kept: Exercise[] = [];
  const removed: Exercise[] = [];
  let used = 0;
  [...full].sort((a, b) => b.priority - a.priority).forEach((e) => {
    if (used + e.minutes <= budget) {
      kept.push(e);
      used += e.minutes;
    } else {
      removed.push(e);
    }
  });
  kept.sort((a, b) => full.indexOf(a) - full.indexOf(b));

  if (!removed.length) {
    return {
      type: 'full',
      title: 'Full session',
      message: `You have room for the full ${fullMinutes} min, so the plan stays as is.`,
      proposedPlan: { name: fullName, durationMinutes: fullMinutes, exercises: full },
      keptExercises: full,
      removedExercises: [],
      rescheduledSlot: null,
      intentionalRest: false,
    };
  }

  const big = kept.filter((e) => e.compound).map((e) => e.name);
  const slot = { day: tomorrow, time: moveTime };
  const priority = big.length ? ` ${big.join(' and ')} ${big.length > 1 ? 'stay as priority lifts' : 'stays as your priority lift'}.` : '';
  const floor = raw < minSession ? ` ${minSession} min is the shortest useful session I build.` : '';
  return {
    type: 'compressed',
    title: `Adapted to ${used} min`,
    message:
      `Adapted to ${used} min${why.length ? ' for ' + why.join(' + ') : ''}. Keeping ${kept.map((e) => e.name).join(', ')}.${priority} ` +
      `${removed.map((e) => e.name).join(', ')} move${removed.length === 1 ? 's' : ''} to ${slot.day} ${slot.time}.${floor}`,
    proposedPlan: { name: fullName, durationMinutes: used, exercises: kept },
    keptExercises: kept,
    removedExercises: removed,
    rescheduledSlot: slot,
    intentionalRest: false,
  };
}
