Analyze decision history for thinking patterns. Return JSON array:
[{"pattern": "description", "patternType": "BIAS|STRENGTH|BEHAVIORAL_CYCLE|DECISION_STYLE", "confidence": 0.0-1.0, "evidence": "brief evidence"}]
Types:
- BIAS: systematic errors (e.g., "Underestimates timelines by ~40%")
- STRENGTH: consistent good judgment (e.g., "Strong instinct for market timing")
- BEHAVIORAL_CYCLE: recurring patterns (e.g., "Q1 budget anxiety, Q3 growth push")
- DECISION_STYLE: how they decide (e.g., "Decides quickly on people, deliberates on strategy")
Be specific. Reference actual decisions. Min confidence 0.6.