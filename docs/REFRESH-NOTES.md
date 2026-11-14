# Clarity refresh: what changed and what was left alone

A pass to make the main views readable in about ten seconds without removing depth. Written as the pull-request note for
this change.

## Changed

- **Gate.** Name and positioning are on screen from the first frame. After the evaluation, the order is: the sentence about
  the visitor, the decision, the way in (which takes keyboard focus), then a three-item preview of what is behind the gate.
  The step list folds away once it has finished. Script-reported and derived evidence moved behind a disclosure.
- **Home.** The hero carries a live card showing the visitor's own decision. Below it: four checkable credentials, then the
  case study's finding as two large numbers (overall change against the stable cohort) with the verdict. A three-item strip
  names policy as code, provenance and privacy by design, each linking to where the site demonstrates it.
- **Program.** A scorecard stays in view while scrolling and always shows the current view's verdict and key numbers. The
  four questions are numbered chapters instead of identical cards, the recommendation is the most prominent element, and the
  measures are cards with their baselines. Team and ownership tables are disclosures.
- **Access.** Leads with the decision, assurance and the one-sentence summary, then four summary figures, then reasons.
  Evidence groups are collapsed with counts; rules, stages, policy and the walkthrough are disclosures.
- **Projects.** A framing line and one phrase per project naming the habit it shares with the security work.
- **Public gateway health.** `GET /api/gateway/health`: aggregates only, cached for a minute, shown on the Access page.
  Outcome figures are withheld below ten evaluations and counts are rounded down, so a figure cannot describe one visitor.
- **Performance.** The case-study dataset is no longer built on Home's first paint: it loads in its own chunk when the
  browser is idle. The portfolio's entry chunk went from 62 kB to 36 kB; the shared framework chunk is unchanged.
- **Fix.** The `.decision` class was used by both the case-study cards and the decision banner. They are now `.choice` and
  `.verdict-banner`.

## Deliberately left unchanged

- **The gate itself.** Server enforcement, the manifest split, CSP, record-before-admit and fail-open with reduced
  assurance are untouched. There is still no way to reach the portfolio without an evaluation: an "executive bypass" would
  make the gate decorative, so the faster path is a shorter route *through* it, not around it.
- **Signal provenance and statement tagging.** Every signal keeps its method, kind, reliability and limitation; every
  narrative sentence keeps its Computed / Explanation / Hypothesis / Caveat tag. They are folded, never removed.
- **Fingerprinting.** Still opt-in, still deletable, still not part of the access decision.
- **The policy.** Same rules, same version, still a pure function, still no numeric score. The scorecard on the Program
  page shows measurements of the synthetic programme; it is not a risk score.
- **The synthetic dataset and its labelling.** Same seed and figures. The "synthetic data" notice stays at the top of the
  case study, and the Home teaser is labelled as synthetic.
- **Credentials.** No employer, date, headcount or metric was added. The credential strip restates the career path and
  tools the owner supplied, and facts about this site.
- **Projects.** No project was added or re-described as a security tool. The framing says plainly that none of them is one.
- **Theme and fonts.** Existing light tokens, Geist and Geist Mono. No new colours were introduced.
- **Admin analytics.** Unchanged apart from sharing its aggregation code with the public health summary.
