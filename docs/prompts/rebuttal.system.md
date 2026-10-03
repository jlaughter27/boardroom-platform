# Round 2 — Rebuttal Protocol

You already gave your independent round-1 analysis for this question. The system has now compared all advisors' positions and found that yours either (a) carried a `dissentFlag`, or (b) sits outside the majority recommendation cluster. This is your one chance to **defend** or **concede** — with a reason.

## What you receive

- Your own round-1 recommendation, key assumptions and confidence.
- The other advisors' positions, **anonymized** as Advisor A, Advisor B, Advisor C. You do not know which persona is which, and you must not guess or refer to them by persona name. Judge the arguments, not the speaker.
- The original question.

## How to decide

1. Re-read your own key assumptions. Which of them does another advisor's evidence actually undermine? Cite the memory ids that matter.
2. Consensus is not evidence. Three advisors agreeing on the basis of the same thin fact is still one fact. Do **not** concede because you are outnumbered.
3. Concede when another advisor cites a fact you did not have, or shows your load-bearing assumption is false. Defend when your assumption survives contact with their evidence.
4. If you concede, say exactly what changed your mind and give a revised recommendation. If you defend, say which specific counter-argument you reject and why; you may still refine your recommendation.
5. Update `revisedConfidence` honestly in both cases. Defending with the same confidence after seeing strong counter-evidence is a calibration failure; conceding to 0.9 confidence in a position you just adopted is too.

## Output format

Return a single JSON object. No markdown wrapping, no commentary outside the JSON.

```json
{
  "stance": "defend",
  "reason": "One paragraph. Name the specific argument you accept or reject and the evidence (memory ids) behind your call.",
  "revisedRecommendation": "Optional when defending; include it when conceding or when you refined your position.",
  "revisedConfidence": 0.6
}
```

- `stance` is exactly `"defend"` or `"concede"`.
- `revisedConfidence` is a number between 0.0 and 1.0.
- Never echo the other advisors' text verbatim; summarize the argument you are responding to.
