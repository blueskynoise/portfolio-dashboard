import type { Assurance, Decision, PolicyDocument, PolicyReason, RuleEvaluation } from '@portfolio/contracts';

/**
 * The access policy.
 *
 * A pure function from facts to a decision. No clock, no network, no
 * randomness: the same facts always produce the same outcome, and every
 * outcome names the rules that produced it.
 *
 * There is deliberately no numeric risk score. Each rule is a readable
 * condition with a stated reason for existing. A score would look more
 * sophisticated and explain less.
 */

export const POLICY_VERSION = '2026.11.2';

export const THRESHOLDS = {
  /** Assessment requests from one address inside the rate window before we stop evaluating. */
  assessmentsPerWindow: 30,
  /** Failed bot challenges from one address inside the rate window before a temporary deny. */
  challengeFailuresPerWindow: 5,
  /** Length of the rate window, in minutes. */
  rateWindowMinutes: 10,
  /**
   * AbuseIPDB "confidence of abuse" percentage at which an address needs
   * bot verification. A policy choice, not a measured optimum: it has not
   * been tuned against this site's traffic, and it only ever asks for a
   * challenge. It never denies on its own.
   */
  abuseConfidence: 75,
} as const;

export type BotVerification =
  /** Token validated by the provider, server to server. */
  | 'passed'
  /** Provider examined the token and rejected it. */
  | 'failed'
  /** Verification is configured but the browser sent no token. */
  | 'missing'
  /** No credentials for the provider. We cannot challenge anyone. */
  | 'unconfigured'
  /** The provider could not be reached. */
  | 'provider_error';

/**
 * Everything the policy is allowed to know. `null` always means "unknown",
 * and no rule may treat unknown as either good or bad.
 */
export interface PolicyFacts {
  bot: BotVerification;
  recentAssessments: number;
  recentChallengeFailures: number;
  torExit: boolean | null;
  hostingNetwork: boolean | null;
  abuseConfidence: number | null;
  /** navigator.webdriver, as reported by the browser. */
  webdriver: boolean | null;
  /** Whether what the browser said about itself matches what the server saw. */
  clientConsistent: boolean | null;
  /** Whether network enrichment produced anything usable. */
  networkContextAvailable: boolean;
}

export interface PolicyOutcome {
  version: string;
  decision: Decision;
  assurance: Assurance;
  reasons: PolicyReason[];
  rules: RuleEvaluation[];
  explanation: string;
}

interface Rule {
  code: string;
  effect: Decision;
  description: string;
  rationale: string;
  evidence: string[];
  /** true = matched, false = not matched, null = the fact needed is unknown. */
  test: (facts: PolicyFacts) => boolean | null;
  summary: (facts: PolicyFacts) => string;
}

const unverified = (facts: PolicyFacts): boolean => facts.bot !== 'passed';

/** `null` when the underlying fact is unknown, so the rule is reported as not evaluable. */
const whenKnown = <T>(fact: T | null, test: (value: T) => boolean): boolean | null =>
  fact === null ? null : test(fact);

export const RULES: readonly Rule[] = [
  {
    code: 'ASSESSMENT_FLOOD',
    effect: 'DENY',
    description: `More than ${THRESHOLDS.assessmentsPerWindow} assessment requests from one address in ${THRESHOLDS.rateWindowMinutes} minutes.`,
    rationale: 'Abuse control. Every assessment costs provider calls; nobody reading a portfolio needs this many.',
    evidence: ['session.request_rate'],
    test: (f) => f.recentAssessments > THRESHOLDS.assessmentsPerWindow,
    summary: (f) => `${f.recentAssessments} assessment requests from this address in the last ${THRESHOLDS.rateWindowMinutes} minutes.`,
  },
  {
    code: 'REPEATED_CHALLENGE_FAILURE',
    effect: 'DENY',
    description: `${THRESHOLDS.challengeFailuresPerWindow} or more failed bot challenges from one address in ${THRESHOLDS.rateWindowMinutes} minutes.`,
    rationale: 'Repeatedly failing a challenge is itself evidence of automation. The deny lapses when the window does.',
    evidence: ['session.challenge_failures'],
    test: (f) => f.recentChallengeFailures >= THRESHOLDS.challengeFailuresPerWindow,
    summary: (f) => `${f.recentChallengeFailures} failed bot challenges from this address in the last ${THRESHOLDS.rateWindowMinutes} minutes.`,
  },
  {
    code: 'BOT_VERIFICATION_FAILED',
    effect: 'CHALLENGE',
    description: 'The bot-verification provider rejected the token the browser presented.',
    rationale: 'A rejected token is a direct, server-validated signal. Expired tokens land here too, which is why this challenges rather than denies.',
    evidence: ['automation.bot_verification'],
    test: (f) => f.bot === 'failed',
    summary: () => 'Bot verification was attempted and did not pass.',
  },
  {
    code: 'BOT_VERIFICATION_MISSING',
    effect: 'CHALLENGE',
    description: 'Bot verification is configured but the request carried no token.',
    rationale: 'Requests that skip the verification step are usually scripts calling the API directly.',
    evidence: ['automation.bot_verification'],
    test: (f) => f.bot === 'missing',
    summary: () => 'No bot-verification token was presented.',
  },
  {
    code: 'HOSTING_NETWORK_UNVERIFIED',
    effect: 'CHALLENGE',
    description: 'The connection comes from a hosting or cloud network and bot verification has not passed.',
    rationale: 'People rarely browse from datacenters; scrapers usually do. Passing verification clears it, so cloud desktops and corporate egress still get in.',
    evidence: ['network.hosting', 'automation.bot_verification'],
    test: (f) => whenKnown(f.hostingNetwork, (hosting) => hosting && unverified(f)),
    summary: () => 'The originating network is classified as hosting infrastructure and the browser is unverified.',
  },
  {
    code: 'ABUSE_REPUTATION_UNVERIFIED',
    effect: 'CHALLENGE',
    description: `The address has an abuse-confidence score of ${THRESHOLDS.abuseConfidence} or more and bot verification has not passed.`,
    rationale: 'Reputation is about an address, not a person, and addresses are shared and reassigned. It justifies a question, not a verdict.',
    evidence: ['network.abuse_confidence', 'automation.bot_verification'],
    test: (f) => whenKnown(f.abuseConfidence, (score) => score >= THRESHOLDS.abuseConfidence && unverified(f)),
    summary: (f) => `The address has an abuse-confidence score of ${f.abuseConfidence} and the browser is unverified.`,
  },
  {
    code: 'AUTOMATION_FLAG_UNVERIFIED',
    effect: 'CHALLENGE',
    description: 'The browser reports that it is under automated control and bot verification has not passed.',
    rationale: 'The flag is self-reported and easy to hide, so its absence means nothing. Its presence is worth a challenge.',
    evidence: ['automation.webdriver', 'automation.bot_verification'],
    test: (f) => whenKnown(f.webdriver, (flag) => flag && unverified(f)),
    summary: () => 'The browser declares itself automated (navigator.webdriver) and is unverified.',
  },
  {
    code: 'CLIENT_EVIDENCE_INCONSISTENT',
    effect: 'CHALLENGE',
    description: 'What the browser said about itself contradicts what the server observed, and bot verification has not passed.',
    rationale: 'A mismatch means the evidence was edited somewhere between the browser and us.',
    evidence: ['browser.consistency', 'automation.bot_verification'],
    test: (f) => whenKnown(f.clientConsistent, (consistent) => !consistent && unverified(f)),
    summary: () => 'Browser-reported details contradict the request the server received.',
  },
];

const canChallenge = (facts: PolicyFacts): boolean => facts.bot !== 'unconfigured' && facts.bot !== 'provider_error';

export function evaluatePolicy(facts: PolicyFacts): PolicyOutcome {
  const rules: RuleEvaluation[] = [];
  const matched: Rule[] = [];
  for (const rule of RULES) {
    const result = rule.test(facts);
    rules.push({
      code: rule.code,
      effect: rule.effect,
      description: rule.description,
      outcome: result === null ? 'not_evaluable' : result ? 'matched' : 'not_matched',
    });
    if (result) matched.push(rule);
  }

  const toReason = (rule: Rule, effect: PolicyReason['effect'] = rule.effect): PolicyReason => ({
    code: rule.code,
    effect,
    summary: rule.summary(facts),
    evidence: rule.evidence,
  });
  const notes = collectNotes(facts);
  const denies = matched.filter((r) => r.effect === 'DENY');
  const challenges = matched.filter((r) => r.effect === 'CHALLENGE');

  if (denies.length > 0) {
    return {
      version: POLICY_VERSION,
      decision: 'DENY',
      assurance: 'standard',
      reasons: [...denies.map((r) => toReason(r)), ...notes],
      rules,
      explanation: `Access was refused: ${denies[0]?.summary(facts)} This is an abuse control and it lifts on its own after ${THRESHOLDS.rateWindowMinutes} minutes.`,
    };
  }

  if (challenges.length > 0 && canChallenge(facts)) {
    return {
      version: POLICY_VERSION,
      decision: 'CHALLENGE',
      assurance: 'standard',
      reasons: [...challenges.map((r) => toReason(r)), ...notes],
      rules,
      explanation: `One more check is needed before access: ${challenges[0]?.summary(facts)}`,
    };
  }

  // From here the decision is ALLOW. What remains is being honest about how much it is worth.
  const reasons: PolicyReason[] = [];
  let assurance: Assurance = 'standard';

  if (challenges.length > 0) {
    // A challenge condition matched but there is no working way to challenge.
    assurance = 'reduced';
    reasons.push({
      code: 'CHALLENGE_UNAVAILABLE_FAIL_OPEN',
      effect: 'ALLOW',
      summary:
        'A condition that would normally require a challenge was met, but bot verification is not available. A public portfolio fails open: access is granted and recorded as reduced assurance.',
      evidence: ['automation.bot_verification'],
    });
    reasons.push(...challenges.map((r) => toReason(r, 'NOTE')));
  }
  if (facts.bot !== 'passed') {
    assurance = 'reduced';
    reasons.push({
      code: facts.bot === 'provider_error' ? 'BOT_VERIFICATION_PROVIDER_ERROR' : 'BOT_VERIFICATION_NOT_PERFORMED',
      effect: 'NOTE',
      summary:
        facts.bot === 'provider_error'
          ? 'The bot-verification provider could not be reached, so automation was not assessed. That is not the same as passing.'
          : 'Bot verification is not configured, so automation was not assessed. That is not the same as passing.',
      evidence: ['automation.bot_verification'],
    });
  }
  if (!facts.networkContextAvailable) {
    assurance = 'reduced';
    reasons.push({
      code: 'NETWORK_CONTEXT_UNAVAILABLE',
      effect: 'NOTE',
      summary: 'No network enrichment was available, so network-based rules could not be evaluated.',
      evidence: ['network.asn'],
    });
  }
  if (assurance === 'standard') {
    reasons.unshift({
      code: 'BASELINE_SATISFIED',
      effect: 'ALLOW',
      summary: 'Bot verification passed and no deny or challenge condition was met.',
      evidence: ['automation.bot_verification'],
    });
  } else if (!reasons.some((r) => r.effect === 'ALLOW')) {
    reasons.unshift({
      code: 'NO_BLOCKING_CONDITION',
      effect: 'ALLOW',
      summary: 'No deny or challenge condition was met on the evidence that was available.',
      evidence: [],
    });
  }
  reasons.push(...notes);

  return {
    version: POLICY_VERSION,
    decision: 'ALLOW',
    assurance,
    reasons,
    rules,
    explanation:
      assurance === 'standard'
        ? 'Access granted. The available evidence satisfies the access policy.'
        : 'Access granted with reduced assurance. Some evidence the policy normally relies on was not available, so this decision says less than a full one would.',
  };
}

/** Things worth writing down that, by design, do not change the decision. */
function collectNotes(facts: PolicyFacts): PolicyReason[] {
  const notes: PolicyReason[] = [];
  if (facts.torExit === true) {
    notes.push({
      code: 'TOR_EXIT_NOT_PENALIZED',
      effect: 'NOTE',
      summary: 'The connection arrives through a Tor exit relay. Using Tor is not a policy violation here and did not affect the decision.',
      evidence: ['network.tor_exit'],
    });
  }
  if (facts.hostingNetwork === true && facts.bot === 'passed') {
    notes.push({
      code: 'HOSTING_NETWORK_VERIFIED',
      effect: 'NOTE',
      summary: 'The network is hosting infrastructure, which often means a VPN, proxy or cloud desktop. Bot verification passed, so it did not affect the decision.',
      evidence: ['network.hosting'],
    });
  }
  if (facts.abuseConfidence !== null && facts.abuseConfidence >= THRESHOLDS.abuseConfidence && facts.bot === 'passed') {
    notes.push({
      code: 'ABUSE_REPUTATION_VERIFIED',
      effect: 'NOTE',
      summary: `The address has an abuse-confidence score of ${facts.abuseConfidence}. Addresses are shared and reassigned; bot verification passed, so it did not affect the decision.`,
      evidence: ['network.abuse_confidence'],
    });
  }
  return notes;
}

export const POLICY_DOCUMENT: PolicyDocument = {
  version: POLICY_VERSION,
  summary:
    'Access policy for a public portfolio. ALLOW is the expected outcome. DENY exists only for abuse control, and CHALLENGE only asks for bot verification.',
  thresholds: { ...THRESHOLDS },
  rules: RULES.map(({ code, effect, description, rationale }) => ({ code, effect, description, rationale })),
  notPenalized: [
    'Using a VPN, a corporate proxy or Tor.',
    'Blocking trackers, third-party cookies or client hints.',
    'An uncommon browser or operating system.',
    'Declining optional recognition of a returning browser.',
    'Any signal that is unknown, unavailable or not consented to.',
  ],
  failurePolicy: [
    'If the bot-verification provider is down or unconfigured, challenge conditions cannot be enforced. Access is granted and the decision is recorded as reduced assurance.',
    'If network enrichment fails, network rules are reported as not evaluable. They are never reported as passed.',
    'Deny rules depend only on first-party counters, so they keep working when every external provider is down.',
    'If the assessment service itself fails, the visitor is told so and can retry. No session is issued without a recorded decision.',
  ],
};
