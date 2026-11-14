import { describe, expect, it } from 'vitest';
import { evaluatePolicy, POLICY_DOCUMENT, POLICY_VERSION, RULES, THRESHOLDS, type PolicyFacts } from './index';

const clean: PolicyFacts = {
  bot: 'passed',
  recentAssessments: 1,
  recentChallengeFailures: 0,
  torExit: false,
  hostingNetwork: false,
  abuseConfidence: 0,
  webdriver: false,
  clientConsistent: true,
  networkContextAvailable: true,
};
const facts = (overrides: Partial<PolicyFacts>): PolicyFacts => ({ ...clean, ...overrides });
const codes = (f: PolicyFacts) => evaluatePolicy(f).reasons.map((r) => r.code);

describe('the normal case', () => {
  it('allows an ordinary verified visitor with standard assurance', () => {
    const outcome = evaluatePolicy(clean);
    expect(outcome).toMatchObject({ decision: 'ALLOW', assurance: 'standard', version: POLICY_VERSION });
    expect(outcome.reasons.map((r) => r.code)).toEqual(['BASELINE_SATISFIED']);
    expect(outcome.rules.every((r) => r.outcome === 'not_matched')).toBe(true);
  });

  it('is deterministic', () => {
    const input = facts({ hostingNetwork: true, bot: 'failed', abuseConfidence: 90 });
    expect(evaluatePolicy(input)).toEqual(evaluatePolicy(input));
  });

  it('reports every rule on every evaluation', () => {
    expect(evaluatePolicy(clean).rules.map((r) => r.code)).toEqual(RULES.map((r) => r.code));
  });
});

describe('privacy tools are not penalised', () => {
  it('allows a verified Tor user and says Tor was noted, not held against them', () => {
    const outcome = evaluatePolicy(facts({ torExit: true }));
    expect(outcome).toMatchObject({ decision: 'ALLOW', assurance: 'standard' });
    expect(outcome.reasons.find((r) => r.code === 'TOR_EXIT_NOT_PENALISED')?.effect).toBe('NOTE');
  });

  it('allows a verified visitor on a hosting network (VPN, proxy, cloud desktop)', () => {
    const outcome = evaluatePolicy(facts({ hostingNetwork: true }));
    expect(outcome.decision).toBe('ALLOW');
    expect(outcome.reasons.map((r) => r.code)).toContain('HOSTING_NETWORK_VERIFIED');
  });

  it('allows a verified visitor on a badly reputed address', () => {
    const outcome = evaluatePolicy(facts({ abuseConfidence: 100 }));
    expect(outcome).toMatchObject({ decision: 'ALLOW', assurance: 'standard' });
    expect(outcome.reasons.map((r) => r.code)).toContain('ABUSE_REPUTATION_VERIFIED');
  });

  it('never challenges on Tor alone, even unverified', () => {
    // Tor with no verification available: nothing else is wrong, so there is nothing to challenge.
    expect(evaluatePolicy(facts({ torExit: true, bot: 'unconfigured' })).decision).toBe('ALLOW');
  });
});

describe('unknown is not clean', () => {
  it('marks rules as not evaluable when their fact is unknown', () => {
    const outcome = evaluatePolicy(
      facts({ hostingNetwork: null, abuseConfidence: null, webdriver: null, clientConsistent: null, torExit: null, networkContextAvailable: false }),
    );
    const byCode = Object.fromEntries(outcome.rules.map((r) => [r.code, r.outcome]));
    expect(byCode.HOSTING_NETWORK_UNVERIFIED).toBe('not_evaluable');
    expect(byCode.ABUSE_REPUTATION_UNVERIFIED).toBe('not_evaluable');
    expect(byCode.AUTOMATION_FLAG_UNVERIFIED).toBe('not_evaluable');
    expect(byCode.CLIENT_EVIDENCE_INCONSISTENT).toBe('not_evaluable');
  });

  it('downgrades assurance when network context is missing, even if verification passed', () => {
    const outcome = evaluatePolicy(facts({ hostingNetwork: null, abuseConfidence: null, torExit: null, networkContextAvailable: false }));
    expect(outcome).toMatchObject({ decision: 'ALLOW', assurance: 'reduced' });
    expect(outcome.reasons.map((r) => r.code)).toContain('NETWORK_CONTEXT_UNAVAILABLE');
    expect(outcome.reasons.map((r) => r.code)).not.toContain('BASELINE_SATISFIED');
  });

  it.each(['unconfigured', 'provider_error'] as const)('never reports "%s" bot verification as satisfied', (bot) => {
    const outcome = evaluatePolicy(facts({ bot }));
    expect(outcome).toMatchObject({ decision: 'ALLOW', assurance: 'reduced' });
    expect(outcome.reasons.map((r) => r.code)).not.toContain('BASELINE_SATISFIED');
    expect(outcome.explanation).toMatch(/reduced assurance/);
  });
});

describe('challenge conditions', () => {
  it.each<[string, Partial<PolicyFacts>]>([
    ['BOT_VERIFICATION_FAILED', { bot: 'failed' }],
    ['BOT_VERIFICATION_MISSING', { bot: 'missing' }],
    ['HOSTING_NETWORK_UNVERIFIED', { bot: 'missing', hostingNetwork: true }],
    ['ABUSE_REPUTATION_UNVERIFIED', { bot: 'failed', abuseConfidence: THRESHOLDS.abuseConfidence }],
    ['AUTOMATION_FLAG_UNVERIFIED', { bot: 'missing', webdriver: true }],
    ['CLIENT_EVIDENCE_INCONSISTENT', { bot: 'failed', clientConsistent: false }],
  ])('%s challenges', (code, overrides) => {
    const outcome = evaluatePolicy(facts(overrides));
    expect(outcome.decision).toBe('CHALLENGE');
    expect(outcome.reasons.map((r) => r.code)).toContain(code);
  });

  it('respects the abuse threshold exactly', () => {
    const below = evaluatePolicy(facts({ bot: 'failed', abuseConfidence: THRESHOLDS.abuseConfidence - 1 }));
    expect(below.reasons.map((r) => r.code)).not.toContain('ABUSE_REPUTATION_UNVERIFIED');
  });

  it('passing verification clears every challenge condition', () => {
    const outcome = evaluatePolicy(facts({ hostingNetwork: true, abuseConfidence: 100, webdriver: true, clientConsistent: false }));
    expect(outcome.decision).toBe('ALLOW');
  });
});

describe('failure policy', () => {
  it('fails open, and says so, when a challenge is warranted but cannot be issued', () => {
    for (const bot of ['unconfigured', 'provider_error'] as const) {
      const outcome = evaluatePolicy(facts({ bot, hostingNetwork: true, webdriver: true }));
      expect(outcome).toMatchObject({ decision: 'ALLOW', assurance: 'reduced' });
      const reasonCodes = outcome.reasons.map((r) => r.code);
      expect(reasonCodes).toContain('CHALLENGE_UNAVAILABLE_FAIL_OPEN');
      // The conditions that matched are kept on the record as notes.
      expect(outcome.reasons.find((r) => r.code === 'HOSTING_NETWORK_UNVERIFIED')?.effect).toBe('NOTE');
      expect(outcome.reasons.find((r) => r.code === 'AUTOMATION_FLAG_UNVERIFIED')?.effect).toBe('NOTE');
    }
  });

  it('deny rules still work when every provider is down', () => {
    const outcome = evaluatePolicy(
      facts({ bot: 'provider_error', networkContextAvailable: false, hostingNetwork: null, abuseConfidence: null, torExit: null, recentAssessments: THRESHOLDS.assessmentsPerWindow + 1 }),
    );
    expect(outcome.decision).toBe('DENY');
  });
});

describe('deny conditions', () => {
  it('denies an assessment flood', () => {
    expect(evaluatePolicy(facts({ recentAssessments: THRESHOLDS.assessmentsPerWindow })).decision).toBe('ALLOW');
    const outcome = evaluatePolicy(facts({ recentAssessments: THRESHOLDS.assessmentsPerWindow + 1 }));
    expect(outcome.decision).toBe('DENY');
    expect(codes(facts({ recentAssessments: THRESHOLDS.assessmentsPerWindow + 1 }))).toContain('ASSESSMENT_FLOOD');
  });

  it('denies repeated challenge failures, and deny outranks challenge', () => {
    const outcome = evaluatePolicy(facts({ bot: 'failed', recentChallengeFailures: THRESHOLDS.challengeFailuresPerWindow }));
    expect(outcome.decision).toBe('DENY');
    expect(outcome.reasons[0]?.code).toBe('REPEATED_CHALLENGE_FAILURE');
  });

  it('a verified visitor is still denied when flooding: verification is not a licence', () => {
    expect(evaluatePolicy(facts({ recentAssessments: 500 })).decision).toBe('DENY');
  });
});

describe('policy document', () => {
  it('publishes every rule with a rationale', () => {
    expect(POLICY_DOCUMENT.rules.map((r) => r.code)).toEqual(RULES.map((r) => r.code));
    expect(POLICY_DOCUMENT.rules.every((r) => r.rationale.length > 20)).toBe(true);
    expect(POLICY_DOCUMENT.version).toBe(POLICY_VERSION);
  });
});
